// @ts-ignore  // 临时忽略类型检查，解决声明文件缺失问题
import { OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { type RedisClientType, createClient } from "redis";
import { notificationService } from "./notification.service";

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

  const order = await prisma.order.findUnique({ where: { id: orderId } });
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

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: toTransitionUpdate(nextStatus),
  });

  notificationService
    .notifyOrderStatusChanged({ orderId: updated.id, fromStatus: order.status, toStatus: nextStatus })
    .catch(() => { });

  return updated;
};

export const acceptTask = async (taskId: number, userId: number) => {
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new OrderError(400, "taskId 不合法");
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new OrderError(400, "userId 不合法");
  }

  const redis = await getRedisClient();
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

export const pickupOrder = async (orderId: number, userId: number) => {
  return transitionOrderStatus(orderId, userId, OrderStatus.PICKED);
};

export const deliverOrder = async (orderId: number, userId: number) => {
  return transitionOrderStatus(orderId, userId, OrderStatus.DELIVERING);
};

export const completeOrder = async (orderId: number, userId: number) => {
  return transitionOrderStatus(orderId, userId, OrderStatus.COMPLETED);
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

    return { orderId, message: "催单成功" };
  } catch (err) {
    await redis.del(key).catch(() => { });
    throw err;
  }
};
