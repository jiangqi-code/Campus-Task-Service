// @ts-ignore  // 临时忽略类型检查，解决声明文件缺失问题
import { OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { type RedisClientType, createClient } from "redis";
import { notificationService } from "./notification.service";
import { creditService, isOnTimeDelivery } from "./credit.service";

export const haversineDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export class OrderError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

type GetOrderListInput = {
  userId: number;
  role: string;
  type?: unknown;
  status?: unknown;
  page?: unknown;
  pageSize?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
};

type ListOrdersInput = {
  userId: number;
  type: unknown;
  page?: unknown;
  pageSize?: unknown;
};

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const isListableOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (
    value === OrderStatus.ACCEPTED ||
    value === OrderStatus.PICKED ||
    value === OrderStatus.DELIVERING ||
    value === OrderStatus.COMPLETED ||
    value === OrderStatus.CANCELLED
  );
};

const computeOrderProgressPercent = (input: {
  status: OrderStatus;
  acceptTime: Date | null;
  etaMinutes: number | null;
}) => {
  const { status, acceptTime, etaMinutes } = input;

  if (status === OrderStatus.COMPLETED) return 100;
  if (status === OrderStatus.ACCEPTED) return 0;
  if (status === OrderStatus.PICKED) return 30;
  if (status === OrderStatus.DELIVERING) {
    const start = acceptTime?.getTime() ?? null;
    const eta = typeof etaMinutes === "number" && Number.isFinite(etaMinutes) && etaMinutes > 0 ? etaMinutes : null;
    if (!start || !eta) return 0;

    const percent = ((Date.now() - start) / (eta * 60_000)) * 100;
    if (!Number.isFinite(percent)) return 0;
    return Math.min(99, Math.max(0, Math.floor(percent)));
  }

  return 0;
};

let redisClient: RedisClientType | null = null;
let redisConnecting: Promise<RedisClientType> | null = null;

const getRedisClient = async () => {
  if (redisClient?.isOpen) return redisClient;
  if (redisConnecting) return redisConnecting;

  const client: RedisClientType = createClient(
    process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined
  );
  client.on("error", () => { });

  redisConnecting = client
    .connect()
    .then(() => {
      redisClient = client;
      return client;
    })
    .finally(() => {
      redisConnecting = null;
    });

  return redisConnecting;
};

const allowedTransitions: Partial<Record<OrderStatus, OrderStatus>> = {
  [OrderStatus.ACCEPTED]: OrderStatus.PICKED,
  [OrderStatus.PICKED]: OrderStatus.DELIVERING,
  [OrderStatus.DELIVERING]: OrderStatus.COMPLETED,
};

const toTransitionUpdate = (nextStatus: OrderStatus) => {
  const now = new Date();
  if (nextStatus === OrderStatus.PICKED) {
    return { status: nextStatus, pickup_time: now };
  }
  if (nextStatus === OrderStatus.DELIVERING) {
    return { status: nextStatus, delivery_time: now };
  }
  if (nextStatus === OrderStatus.COMPLETED) {
    return { status: nextStatus, complete_time: now };
  }
  return { status: nextStatus };
};

const transitionOrderStatus = async (orderId: number, userId: number, nextStatus: OrderStatus) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderError(404, "订单不存在");
    }
    if (order.taker_id !== userId) {
      throw new OrderError(403, "无权限");
    }

    const normalizeStatus = (value: unknown) => (typeof value === "string" ? value : String(value));
    const allowedNext = allowedTransitions[order.status];
    console.log("[transitionOrderStatus]", {
      "order.status": order.status,
      nextStatus,
      allowedNext,
    });

    if (!allowedNext || normalizeStatus(allowedNext) !== normalizeStatus(nextStatus)) {
      throw new OrderError(409, "非法状态转换");
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: toTransitionUpdate(nextStatus),
    });

    if (nextStatus === OrderStatus.COMPLETED) {
      const completeTime = updated.complete_time ?? new Date();
      const onTime = isOnTimeDelivery({
        acceptTime: order.accept_time,
        createdAt: order.created_at,
        completeTime,
        etaMinutes: order.eta_minutes,
      });
      await creditService.changeCreditScore({
        tx,
        userId,
        delta: 2 + (onTime ? 1 : 0),
      });
    }

    return { order, updated };
  });

  notificationService
    .notifyOrderStatusChanged({ orderId: result.updated.id, fromStatus: result.order.status, toStatus: nextStatus })
    .catch(() => { });

  return result.updated;
};

const transitionOrderStatusWithTrack = async (
  orderId: number,
  userId: number,
  nextStatus: OrderStatus,
  trackUpdate?: { pickup_photo_url?: string; delivery_photo_url?: string }
) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const trimmedPickup = trackUpdate?.pickup_photo_url?.trim();
  const trimmedDelivery = trackUpdate?.delivery_photo_url?.trim();
  const normalizedTrack =
    trimmedPickup || trimmedDelivery
      ? {
        pickup_photo_url: trimmedPickup || undefined,
        delivery_photo_url: trimmedDelivery || undefined,
      }
      : undefined;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderError(404, "订单不存在");
    }
    if (order.taker_id !== userId) {
      throw new OrderError(403, "无权限");
    }

    const normalizeStatus = (value: unknown) => (typeof value === "string" ? value : String(value));
    const allowedNext = allowedTransitions[order.status];
    console.log("[transitionOrderStatusWithTrack]", {
      "order.status": order.status,
      nextStatus,
      allowedNext,
    });

    if (!allowedNext || normalizeStatus(allowedNext) !== normalizeStatus(nextStatus)) {
      throw new OrderError(409, "非法状态转换");
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: toTransitionUpdate(nextStatus),
    });

    if (normalizedTrack) {
      await tx.orderTrack.upsert({
        where: { order_id: orderId },
        update: normalizedTrack,
        create: { order_id: orderId, ...normalizedTrack },
      });
    }

    if (nextStatus === OrderStatus.COMPLETED) {
      const completeTime = updated.complete_time ?? new Date();
      const onTime = isOnTimeDelivery({
        acceptTime: order.accept_time,
        createdAt: order.created_at,
        completeTime,
        etaMinutes: order.eta_minutes,
      });
      await creditService.changeCreditScore({
        tx,
        userId,
        delta: 2 + (onTime ? 1 : 0),
      });
    }

    return { order, updated };
  });

  notificationService
    .notifyOrderStatusChanged({ orderId: result.updated.id, fromStatus: result.order.status, toStatus: nextStatus })
    .catch(() => { });

  return result.updated;
};

export const acceptTask = async (taskId: number, userId: number) => {
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new OrderError(400, "taskId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const redis = await getRedisClient();
  try {
    await redis.incr(`stat:runner:grab_attempts:${userId}`);
  } catch { }
  const lockKey = `lock:task:${taskId}`;

  const locked = await redis.setNX(lockKey, "1");
  if (!locked) {
    throw new OrderError(409, "任务正在被抢");
  }

  try {
    await redis.expire(lockKey, 5);

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new OrderError(404, "任务不存在");
    }
    if (task.status !== TaskStatus.PENDING) {
      throw new OrderError(409, "任务已被接单");
    }

    const toFiniteNumberOrNull = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
      if (typeof value === "object") {
        const maybeDecimal = value as { toNumber?: () => number };
        if (typeof maybeDecimal.toNumber === "function") {
          const n = maybeDecimal.toNumber();
          return Number.isFinite(n) ? n : null;
        }
      }
      return null;
    };

    const pickupLat = toFiniteNumberOrNull((task as unknown as Record<string, unknown>).pickup_lat);
    const pickupLng = toFiniteNumberOrNull((task as unknown as Record<string, unknown>).pickup_lng);
    const deliveryLat = toFiniteNumberOrNull((task as unknown as Record<string, unknown>).delivery_lat);
    const deliveryLng = toFiniteNumberOrNull((task as unknown as Record<string, unknown>).delivery_lng);

    const etaMinutes = (() => {
      if (pickupLat === null || pickupLng === null || deliveryLat === null || deliveryLng === null) {
        return 30;
      }
      const distanceKm = Number(
        haversineDistanceKm(pickupLat, pickupLng, deliveryLat, deliveryLng).toFixed(2)
      );
      return Math.ceil(distanceKm * 2 + 10);
    })();

    const acceptTime = new Date();
    const order = await prisma.$transaction(async (tx) => {
      const finalPrice = task.fee_total.plus(task.tip ?? new Prisma.Decimal(0));

      const publisherWallet = await tx.userWallet.upsert({
        where: { user_id: task.publisher_id },
        create: { user_id: task.publisher_id },
        update: {},
      });

      const freeze = await tx.userWallet.updateMany({
        where: { id: publisherWallet.id, balance: { gte: finalPrice } },
        data: { balance: { decrement: finalPrice }, frozen: { increment: finalPrice } },
      });
      if (freeze.count !== 1) {
        throw new OrderError(409, "发布者余额不足");
      }

      const created = await tx.order.create({
        data: {
          task_id: taskId,
          taker_id: userId,
          status: OrderStatus.ACCEPTED,
          accept_time: acceptTime,
          final_price: finalPrice,
          eta_minutes: etaMinutes,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.ACCEPTED },
      });

      return created;
    });

    notificationService
      .notifyOrderStatusChanged({ orderId: order.id, toStatus: OrderStatus.ACCEPTED })
      .catch(() => { });

    return order;
  } finally {
    await redis.del(lockKey).catch(() => { });
  }
};

export const pickupOrder = async (orderId: number, userId: number, pickupPhotoUrl?: string) => {
  const url = typeof pickupPhotoUrl === "string" && pickupPhotoUrl.trim() ? pickupPhotoUrl.trim() : undefined;
  return transitionOrderStatusWithTrack(orderId, userId, OrderStatus.PICKED, url ? { pickup_photo_url: url } : undefined);
};

export const deliverOrder = async (orderId: number, userId: number, deliveryPhotoUrl?: string) => {
  const url = typeof deliveryPhotoUrl === "string" && deliveryPhotoUrl.trim() ? deliveryPhotoUrl.trim() : undefined;
  return transitionOrderStatusWithTrack(
    orderId,
    userId,
    OrderStatus.DELIVERING,
    url ? { delivery_photo_url: url } : undefined
  );
};

export const completeOrder = async (orderId: number, userId: number, deliveryPhotoUrl?: string) => {
  const url = typeof deliveryPhotoUrl === "string" && deliveryPhotoUrl.trim() ? deliveryPhotoUrl.trim() : undefined;
  return transitionOrderStatusWithTrack(orderId, userId, OrderStatus.COMPLETED, url ? { delivery_photo_url: url } : undefined);
};

const isRunner = (role: string) => role.trim().toUpperCase() === "RUNNER";
const isAdmin = (role: string) => role.trim().toUpperCase() === "ADMIN";

const selectOrderTrack = {
  id: true,
  order_id: true,
  pickup_photo_url: true,
  delivery_photo_url: true,
  location_points_json: true,
  created_at: true,
  updated_at: true,
} as const;

export const uploadPickupPhoto = async (orderId: number, userId: number, photoUrl: string) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }
  if (typeof photoUrl !== "string" || !photoUrl.trim()) {
    throw new OrderError(400, "photoUrl 不合法");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, taker_id: true },
  });
  if (!order) {
    throw new OrderError(404, "订单不存在");
  }
  if (order.taker_id !== userId) {
    throw new OrderError(403, "无权限");
  }
  if (
    order.status !== OrderStatus.PICKED &&
    order.status !== OrderStatus.DELIVERING &&
    order.status !== OrderStatus.COMPLETED
  ) {
    throw new OrderError(409, "订单状态必须为 PICKED / DELIVERING / COMPLETED");
  }

  const track = await prisma.orderTrack.upsert({
    where: { order_id: orderId },
    update: { pickup_photo_url: photoUrl.trim() },
    create: { order_id: orderId, pickup_photo_url: photoUrl.trim() },
    select: selectOrderTrack,
  });

  return track;
};

export const uploadDeliveryPhoto = async (orderId: number, userId: number, photoUrl: string) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }
  if (typeof photoUrl !== "string" || !photoUrl.trim()) {
    throw new OrderError(400, "photoUrl 不合法");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, taker_id: true },
  });
  if (!order) {
    throw new OrderError(404, "订单不存在");
  }
  if (order.taker_id !== userId) {
    throw new OrderError(403, "无权限");
  }
  if (order.status !== OrderStatus.DELIVERING && order.status !== OrderStatus.COMPLETED) {
    throw new OrderError(409, "订单状态必须为 DELIVERING / COMPLETED");
  }

  const track = await prisma.orderTrack.upsert({
    where: { order_id: orderId },
    update: { delivery_photo_url: photoUrl.trim() },
    create: { order_id: orderId, delivery_photo_url: photoUrl.trim() },
    select: selectOrderTrack,
  });

  return track;
};

export const getOrderTrack = async (orderId: number, userId: number, role: string) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }
  const roleStr = typeof role === "string" ? role : String(role);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      taker_id: true,
      accept_time: true,
      pickup_time: true,
      delivery_time: true,
      complete_time: true,
      eta_minutes: true,
      task: {
        select: {
          publisher_id: true,
          pickup_lat: true,
          pickup_lng: true,
          delivery_lat: true,
          delivery_lng: true,
        },
      },
    },
  });
  if (!order) {
    throw new OrderError(404, "订单不存在");
  }

  const allowed =
    isAdmin(roleStr) ||
    (isRunner(roleStr) ? order.taker_id === userId : order.task.publisher_id === userId);
  if (!allowed) {
    throw new OrderError(403, "无权限");
  }

  const track = await prisma.orderTrack.upsert({
    where: { order_id: orderId },
    update: {},
    create: { order_id: orderId },
    select: selectOrderTrack,
  });

  const toFiniteNumberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === "object") {
      const maybeDecimal = value as { toNumber?: () => number };
      if (typeof maybeDecimal.toNumber === "function") {
        const n = maybeDecimal.toNumber();
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  };

  const pickupLat = toFiniteNumberOrNull((order.task as unknown as Record<string, unknown>).pickup_lat);
  const pickupLng = toFiniteNumberOrNull((order.task as unknown as Record<string, unknown>).pickup_lng);
  const deliveryLat = toFiniteNumberOrNull((order.task as unknown as Record<string, unknown>).delivery_lat);
  const deliveryLng = toFiniteNumberOrNull((order.task as unknown as Record<string, unknown>).delivery_lng);

  const totalEtaMinutes =
    typeof order.eta_minutes === "number" && Number.isFinite(order.eta_minutes) && order.eta_minutes > 0
      ? Math.trunc(order.eta_minutes)
      : null;

  const now = Date.now();
  const startAt = order.pickup_time?.getTime() ?? null;
  const completeAt = order.complete_time?.getTime() ?? null;
  const elapsedMinutes =
    startAt && startAt > 0 && completeAt === null ? Math.max(0, Math.floor((now - startAt) / 60000)) : 0;

  const etaRemaining =
    totalEtaMinutes === null
      ? null
      : completeAt
        ? 0
        : startAt
          ? Math.max(0, totalEtaMinutes - elapsedMinutes)
          : totalEtaMinutes;

  const computeProgress = () => {
    if (pickupLat === null || pickupLng === null || deliveryLat === null || deliveryLng === null) return null;
    if (!startAt) return 0;
    if (completeAt) return 1;
    if (!totalEtaMinutes) return 0.5;
    const ratio = (now - startAt) / (totalEtaMinutes * 60_000);
    if (!Number.isFinite(ratio)) return 0.5;
    return Math.min(0.98, Math.max(0, ratio));
  };

  const progress = computeProgress();
  const current_location =
    progress === null
      ? null
      : {
        lat: Number((pickupLat! + (deliveryLat! - pickupLat!) * progress).toFixed(6)),
        lng: Number((pickupLng! + (deliveryLng! - pickupLng!) * progress).toFixed(6)),
      };

  return {
    pickup_photo_url: track.pickup_photo_url,
    delivery_photo_url: track.delivery_photo_url,
    pickup_time: order.pickup_time,
    delivery_time: order.complete_time ?? order.delivery_time,
    eta_minutes: etaRemaining,
    current_location,
  };
};

export const getOrderDetail = async (orderId: number, userId: number, role: string) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const roleStr = typeof role === "string" ? role : String(role);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      final_price: true,
      created_at: true,
      accept_time: true,
      taker_id: true,
      pickup_time: true,
      delivery_time: true,
      complete_time: true,
      eta_minutes: true,
      task: {
        select: {
          pickup_address: true,
          delivery_address: true,
          fee_total: true,
          tip: true,
          publisher_id: true,
          publisher: { select: { id: true, nickname: true } },
        },
      },
      taker: { select: { id: true, nickname: true, phone: true } },
    },
  });

  if (!order) {
    throw new OrderError(404, "订单不存在");
  }

  const allowed =
    isAdmin(roleStr) ||
    (isRunner(roleStr) ? order.taker_id === userId : order.task.publisher_id === userId);
  if (!allowed) {
    throw new OrderError(403, "无权限");
  }

  const track = await prisma.orderTrack.findUnique({
    where: { order_id: orderId },
    select: { pickup_photo_url: true, delivery_photo_url: true },
  });

  const isAcceptedOrAfter =
    order.status === OrderStatus.ACCEPTED ||
    order.status === OrderStatus.PICKED ||
    order.status === OrderStatus.DELIVERING ||
    order.status === OrderStatus.COMPLETED;

  const accept_time = order.accept_time ?? (isAcceptedOrAfter ? order.created_at : null);
  const progress_percent = computeOrderProgressPercent({
    status: order.status,
    acceptTime: accept_time,
    etaMinutes: order.eta_minutes ?? null,
  });

  return {
    id: order.id,
    accept_time,
    status: order.status,
    progress_percent,
    final_price: order.final_price ?? null,
    created_at: order.created_at,
    task: {
      pickup_address: order.task.pickup_address,
      delivery_address: order.task.delivery_address,
      fee_total: order.task.fee_total,
      tip: order.task.tip ?? null,
    },
    taker: {
      id: order.taker?.id ?? null,
      nickname: order.taker?.nickname ?? null,
      phone: order.taker?.phone ?? null,
    },
    publisher: {
      id: order.task.publisher.id,
      nickname: order.task.publisher.nickname,
    },
    track: {
      pickup_photo_url: track?.pickup_photo_url ?? null,
      delivery_photo_url: track?.delivery_photo_url ?? null,
      pickup_time: order.pickup_time,
      delivery_time: order.complete_time ?? order.delivery_time,
      eta_minutes: order.eta_minutes ?? null,
    },
  };
};

const roundMoney = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const cancelOrder = async (orderId: number, userId: number) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  let fromStatus: OrderStatus | null = null;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        task_id: true,
        status: true,
        taker_id: true,
        final_price: true,
        task: { select: { publisher_id: true, fee_total: true, tip: true } },
      },
    });

    if (!order) {
      throw new OrderError(404, "订单不存在");
    }

    fromStatus = order.status;

    const isPublisher = order.task.publisher_id === userId;
    const isTaker = order.taker_id === userId;
    if (!isPublisher && !isTaker) {
      throw new OrderError(403, "无权限");
    }

    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) {
      throw new OrderError(409, "订单状态不允许取消");
    }

    const settled = await tx.earning.findFirst({
      where: { order_id: orderId, type: "ORDER", status: "SETTLED" },
      select: { id: true },
    });
    if (settled) {
      throw new OrderError(409, "订单已结算，无法取消");
    }

    const computed = order.task.fee_total.plus(order.task.tip ?? new Prisma.Decimal(0));
    const amount = order.final_price ?? computed;
    if (!amount || !amount.gt(0)) {
      throw new OrderError(400, "final_price 不合法");
    }

    let refundAmount = amount;
    let platformAmount = new Prisma.Decimal(0);
    let takerAmount = new Prisma.Decimal(0);

    if (order.status === OrderStatus.PENDING) {
      refundAmount = amount;
    } else if (order.status === OrderStatus.ACCEPTED) {
      refundAmount = roundMoney(amount.mul(new Prisma.Decimal("0.8")));
      platformAmount = roundMoney(amount.minus(refundAmount));
    } else if (order.status === OrderStatus.PICKED || order.status === OrderStatus.DELIVERING) {
      const takerId = order.taker_id;
      if (!takerId) {
        throw new OrderError(409, "订单未指定跑腿员");
      }

      refundAmount = roundMoney(amount.mul(new Prisma.Decimal("0.5")));
      takerAmount = roundMoney(amount.minus(refundAmount));
    } else {
      throw new OrderError(409, "订单状态不允许取消");
    }

    const publisherWallet = await tx.userWallet.upsert({
      where: { user_id: order.task.publisher_id },
      create: { user_id: order.task.publisher_id },
      update: {},
    });

    const publisherBeforeTotal = publisherWallet.balance.plus(publisherWallet.frozen);
    const publisherAfterTotal = publisherBeforeTotal.minus(platformAmount).minus(takerAmount);

    const refund = await tx.userWallet.updateMany({
      where: { id: publisherWallet.id, frozen: { gte: amount } },
      data: { frozen: { decrement: amount }, balance: { increment: refundAmount } },
    });
    if (refund.count !== 1) {
      throw new OrderError(409, "发布者冻结金额不足");
    }

    if (takerAmount.gt(0)) {
      const takerId = order.taker_id;
      if (!takerId) {
        throw new OrderError(409, "订单未指定跑腿员");
      }

      const takerWallet = await tx.userWallet.upsert({
        where: { user_id: takerId },
        create: { user_id: takerId },
        update: {},
      });

      const takerBeforeTotal = takerWallet.balance.plus(takerWallet.frozen);
      const takerAfterTotal = takerBeforeTotal.plus(takerAmount);

      await tx.userWallet.update({
        where: { id: takerWallet.id },
        data: { balance: { increment: takerAmount } },
      });

      await tx.walletLog.create({
        data: {
          wallet_id: takerWallet.id,
          type: "ORDER_CANCEL_COMPENSATE",
          amount: takerAmount,
          ref_order_id: order.id,
          before_balance: takerBeforeTotal,
          after_balance: takerAfterTotal,
        },
      });
    }

    await tx.walletLog.create({
      data: {
        wallet_id: publisherWallet.id,
        type: "ORDER_CANCEL_REFUND",
        amount: refundAmount,
        ref_order_id: order.id,
        before_balance: publisherBeforeTotal,
        after_balance: publisherAfterTotal,
      },
    });

    await tx.task.update({
      where: { id: order.task_id },
      data: { status: TaskStatus.PENDING },
    });

    const nextOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED },
    });

    if (
      isTaker &&
      (order.status === OrderStatus.ACCEPTED ||
        order.status === OrderStatus.PICKED ||
        order.status === OrderStatus.DELIVERING)
    ) {
      await creditService.changeCreditScore({
        tx,
        userId,
        delta: -10,
      });
    }

    return { order: nextOrder, refundAmount, platformAmount, takerAmount };
  });

  notificationService
    .notifyOrderStatusChanged({ orderId: result.order.id, fromStatus: fromStatus ?? undefined, toStatus: result.order.status })
    .catch(() => { });

  return result;
};

export const urgeOrder = async (orderId: number, userId: number) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new OrderError(400, "orderId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      taker_id: true,
      task: { select: { publisher_id: true } },
    },
  });

  if (!order) {
    throw new OrderError(404, "订单不存在");
  }
  if (order.task.publisher_id !== userId) {
    throw new OrderError(403, "无权限");
  }
  if (order.status !== OrderStatus.ACCEPTED && order.status !== OrderStatus.DELIVERING) {
    throw new OrderError(409, "订单状态必须为 ACCEPTED 或 DELIVERING");
  }
  if (!order.taker_id) {
    throw new OrderError(409, "订单未指定跑腿员");
  }

  const redis = await getRedisClient();
  const key = `urge:order:${orderId}`;

  const ok = await redis.setNX(key, String(Date.now()));
  if (!ok) {
    throw new OrderError(429, "5 分钟内只能催单一次");
  }

  try {
    await redis.expire(key, 300);

    const nowIso = new Date().toISOString();

    console.log("[urgeOrder]", {
      orderId,
      publisherId: userId,
      takerId: order.taker_id,
      status: order.status,
      at: nowIso,
    });

    await prisma.$transaction(async (tx) => {
      const existing = await tx.orderTrack.findUnique({
        where: { order_id: orderId },
        select: { id: true, location_points_json: true },
      });

      const prev = existing?.location_points_json as unknown;
      const next = Array.isArray(prev) ? [...prev] : prev ? [prev] : [];
      next.push({ type: "URGE", by_user_id: userId, at: nowIso });

      if (existing) {
        await tx.orderTrack.update({
          where: { id: existing.id },
          data: { location_points_json: next as Prisma.InputJsonValue },
        });
      } else {
        await tx.orderTrack.create({
          data: { order_id: orderId, location_points_json: next as Prisma.InputJsonValue },
        });
      }
    });

    notificationService
      .notifyOrderUrged({ orderId, publisherId: userId, takerId: order.taker_id, at: nowIso })
      .catch(() => { });

    return { orderId, message: "催单成功" };
  } catch (err) {
    await redis.del(key).catch(() => { });
    throw err;
  }
};

export const listOrders = async (input: ListOrdersInput) => {
  if (!Number.isFinite(input.userId) || input.userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const page = Math.max(1, parseIntOr(input.page, 1));
  const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
  const skip = (page - 1) * pageSize;

  const typeRaw = typeof input.type === "string" ? input.type.trim().toLowerCase() : "";
  const type = typeRaw === "published" || typeRaw === "taken" ? typeRaw : "";
  if (!type) {
    throw new OrderError(400, "type 不合法");
  }

  const where: Prisma.OrderWhereInput =
    type === "published" ? { task: { publisher_id: input.userId } } : { taker_id: input.userId };

  const publishedSelect = {
    id: true,
    status: true,
    created_at: true,
    taker_id: true,
    task: { select: { pickup_address: true, delivery_address: true, fee_total: true, tip: true } },
    taker: { select: { nickname: true } },
  } as const;

  const takenSelect = {
    id: true,
    status: true,
    created_at: true,
    final_price: true,
    task: { select: { pickup_address: true, delivery_address: true, fee_total: true, tip: true } },
  } as const;

  const select = type === "published" ? publishedSelect : takenSelect;

  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: pageSize,
      select,
    }),
  ]);

  const mapped = (items as Array<any>).map((order) => {
    const base = {
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      pickup_address: order.task.pickup_address,
      delivery_address: order.task.delivery_address,
      fee_total: order.task.fee_total,
      tip: order.task.tip ?? null,
    };

    if (type === "taken") {
      return { ...base, final_price: order.final_price ?? null };
    }
    return {
      ...base,
      taker_id: order.taker_id ?? null,
      taker_nickname: order.taker?.nickname ?? null,
    };
  });

  return { page, pageSize, total, items: mapped };
};

export const getOrderList = async (input: GetOrderListInput) => {
  if (!Number.isFinite(input.userId) || input.userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const role = typeof input.role === "string" ? input.role : String(input.role);

  const page = Math.max(1, parseIntOr(input.page, 1));
  const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
  const skip = (page - 1) * pageSize;

  const typeRaw = typeof input.type === "string" ? input.type.trim().toLowerCase() : "";
  const type = typeRaw === "published" || typeRaw === "taken" ? typeRaw : "";
  if (typeRaw && !type) {
    throw new OrderError(400, "type 不合法");
  }

  const statusRaw = typeof input.status === "string" ? input.status.trim() : input.status;
  const status = statusRaw ? String(statusRaw) : "";
  if (status && !isListableOrderStatus(status)) {
    throw new OrderError(400, "status 不合法");
  }

  const sortByRaw = typeof input.sortBy === "string" ? input.sortBy.trim() : "";
  const sortBy = sortByRaw === "updated_at" ? "updated_at" : "created_at";

  const sortOrderRaw = typeof input.sortOrder === "string" ? input.sortOrder.trim().toLowerCase() : "";
  const sortOrder = sortOrderRaw === "asc" ? "asc" : "desc";

  const view = type || (role === "USER" ? "published" : role === "RUNNER" ? "taken" : "");

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status: status as OrderStatus } : undefined),
    ...(type === "published"
      ? { task: { publisher_id: input.userId } }
      : type === "taken"
        ? { taker_id: input.userId }
        : role === "USER"
          ? { task: { publisher_id: input.userId } }
          : role === "RUNNER"
            ? { taker_id: input.userId }
            : role === "ADMIN"
              ? {}
              : { task: { publisher_id: input.userId } }),
  };

  const orderBy = { [sortBy]: sortOrder } as Prisma.OrderOrderByWithRelationInput;

  const publishedSelect = {
    id: true,
    status: true,
    created_at: true,
    taker_id: true,
    task: { select: { pickup_address: true, delivery_address: true, fee_total: true, tip: true } },
    taker: { select: { nickname: true } },
  } as const;

  const takenSelect = {
    id: true,
    status: true,
    created_at: true,
    final_price: true,
    task: { select: { pickup_address: true, delivery_address: true, fee_total: true, tip: true } },
  } as const;

  const defaultSelect = {
    id: true,
    status: true,
    created_at: true,
    task: { select: { pickup_address: true, delivery_address: true, fee_total: true, tip: true } },
  } as const;

  const select = view === "published" ? publishedSelect : view === "taken" ? takenSelect : defaultSelect;

  const [total, items] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select,
    }),
  ]);

  const mapped = (items as Array<any>).map((order) => {
    const base = {
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      pickup_address: order.task.pickup_address,
      delivery_address: order.task.delivery_address,
      fee_total: order.task.fee_total,
      tip: order.task.tip ?? null,
    };

    if (view === "taken") {
      return { ...base, final_price: order.final_price ?? null };
    }
    if (view === "published") {
      return {
        ...base,
        taker_id: order.taker_id ?? null,
        taker_nickname: order.taker?.nickname ?? null,
      };
    }
    return base;
  });

  return { page, pageSize, total, items: mapped };
};
