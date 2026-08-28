// 解决找不到模块声明文件的问题
// @ts-ignore
import { Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { MapError, MapService } from "./map.service";
import { calculateDeliveryFee } from "./systemConfig.service";
import { consumeUserCoupon, CouponError, quoteUserCoupon } from "./coupon.service";

export class TaskError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();
const mapService = new MapService();

type PublishTaskInput = {
  publisherId: number;
  pickup_address: string;
  pickup_lat?: string | number | null;
  pickup_lng?: string | number | null;
  delivery_address: string;
  delivery_lat?: string | number | null;
  delivery_lng?: string | number | null;
  type: string;
  urgency?: number | null;
  remark?: string | null;
  images_json?: unknown;
  weight?: string | null;
  size?: string | null;
  is_fragile?: boolean | null;
  need_inspection?: boolean | null;
  is_urgent?: boolean | null;
  tip?: string | number | null;
  scheduled_time?: string | number | Date | null;
  user_coupon_id?: string | null;
};

type ListTaskInput = {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  sort?: string;
  sortOrder?: string;
  lat?: number;
  lng?: number;
};

type CancelTaskInput = {
  taskId: number;
  publisherId: number;
  cancelReason?: string | null;
};

const toOptionalDecimal = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return new Prisma.Decimal(value);
  if (typeof value === "string" && value.trim()) return new Prisma.Decimal(value.trim());
  throw new TaskError(400, "金额格式不正确");
};

const toRequiredDecimal = (value: string | number) => {
  const dec = toOptionalDecimal(value);
  if (!dec) throw new TaskError(400, "金额为必填");
  return dec;
};

const roundMoney = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const toOptionalCoordinateDecimal = (
  value: string | number | null | undefined,
  fieldName: string,
) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return new Prisma.Decimal(value);
  if (typeof value === "string" && value.trim()) return new Prisma.Decimal(value.trim());
  throw new TaskError(400, `${fieldName} 格式不正确`);
};

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const toOptionalDateTime = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value.trim());
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  return undefined;
};

export class TaskService {
  async getNearbyTasks(input: { lat: number; lng: number; radius?: number }) {
    const lat = input.lat;
    const lng = input.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TaskError(400, "lat/lng 不合法");
    }

    const radius = Number.isFinite(input.radius) ? Math.max(0.1, Number(input.radius)) : 5;

    // 修改：计算取件点到送达点的距离
    const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.delivery_lat - t.pickup_lat) / 2), 2) + COS(RADIANS(t.pickup_lat)) * COS(RADIANS(t.delivery_lat)) * POWER(SIN(RADIANS(t.delivery_lng - t.pickup_lng) / 2), 2)))`;
    const distanceKm = Prisma.sql`ROUND(${distance}, 2)`;

    const items = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
      SELECT t.*, ${distanceKm} AS distance_km
      FROM tasks t
      WHERE t.status = ${TaskStatus.PENDING}
        AND t.pickup_lat IS NOT NULL
        AND t.pickup_lng IS NOT NULL
      HAVING distance_km <= ${radius}
      ORDER BY distance_km ASC, t.created_at DESC
    `,
    );


    const normalizedItems = items.map((it: Record<string, unknown>) => {
      const raw = (it as { distance_km?: unknown }).distance_km;
      const n = typeof raw === "number" ? raw : Number(raw);
      return {
        ...it,
        distance_km: Number.isFinite(n) ? Number(n.toFixed(2)) : null,
      };
    });

    return { items: normalizedItems };
  }

  async nearbyTasks(input: {
    lat: number;
    lng: number;
    radius?: number;
    page?: number;
    pageSize?: number;
  }) {
    const lat = input.lat;
    const lng = input.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TaskError(400, "lat/lng 不合法");
    }

    const radius = Number.isFinite(input.radius) ? Math.max(0.1, Number(input.radius)) : 5;
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.delivery_lat - t.pickup_lat) / 2), 2) + COS(RADIANS(t.pickup_lat)) * COS(RADIANS(t.delivery_lat)) * POWER(SIN(RADIANS(t.delivery_lng - t.pickup_lng) / 2), 2)))`;
    const distanceKm = Prisma.sql`ROUND(${distance}, 2)`;

    const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>(
      Prisma.sql`
        SELECT COUNT(*) AS total
        FROM (
          SELECT t.id, ${distanceKm} AS distance_km
          FROM tasks t
          WHERE t.status = ${TaskStatus.PENDING}
            AND t.pickup_lat IS NOT NULL
            AND t.pickup_lng IS NOT NULL
          HAVING distance_km <= ${radius}
        ) x
      `,
    );
    const total = Number((totalRows[0] as { total: bigint | number } | undefined)?.total ?? 0);

    const items = await prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT t.*, ${distanceKm} AS distance_km
        FROM tasks t
        WHERE t.status = ${TaskStatus.PENDING}
          AND t.pickup_lat IS NOT NULL
          AND t.pickup_lng IS NOT NULL
        HAVING distance_km <= ${radius}
        ORDER BY distance_km ASC, t.created_at DESC
        LIMIT ${pageSize} OFFSET ${skip}
      `,
    );

    const normalizedItems = items.map((it: Record<string, unknown>) => {
      const raw = (it as { distance_km?: unknown }).distance_km;
      const n = typeof raw === "number" ? raw : Number(raw);
      return {
        ...it,
        distance_km: Number.isFinite(n) ? Number(n.toFixed(2)) : null,
      };
    });

    return { page, pageSize, total, items: normalizedItems };
  }

  async publish(input: PublishTaskInput) {
    const pickup_address = input.pickup_address?.trim();
    const delivery_address = input.delivery_address?.trim();
    const type = input.type?.trim();

    if (!pickup_address || !delivery_address) {
      throw new TaskError(400, "地址不能为空");
    }
    if (!type) {
      throw new TaskError(400, "type 不能为空");
    }

    const tip = toOptionalDecimal(input.tip ?? 0) ?? new Prisma.Decimal(0);
    if (tip.lt(0)) {
      throw new TaskError(400, "tip 不能小于 0");
    }

    const pickup_lat = toOptionalCoordinateDecimal(input.pickup_lat, "pickup_lat");
    const pickup_lng = toOptionalCoordinateDecimal(input.pickup_lng, "pickup_lng");
    const delivery_lat = toOptionalCoordinateDecimal(input.delivery_lat, "delivery_lat");
    const delivery_lng = toOptionalCoordinateDecimal(input.delivery_lng, "delivery_lng");

    if (!pickup_lat || !pickup_lng || !delivery_lat || !delivery_lng) {
      throw new TaskError(400, "发布任务必须提供取件和送达坐标");
    }

    const is_urgent = typeof input.is_urgent === "boolean" ? input.is_urgent : false;

    // 直接使用 Haversine 公式计算距离
    const R = 6371; // 地球半径（公里）
    const dLat = (delivery_lat.toNumber() - pickup_lat.toNumber()) * Math.PI / 180;
    const dLng = (delivery_lng.toNumber() - pickup_lng.toNumber()) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(pickup_lat.toNumber() * Math.PI / 180) * Math.cos(delivery_lat.toNumber() * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    const distanceResult = { distance_km: Number(distanceKm.toFixed(2)) };

    const fee_total = await calculateDeliveryFee({
      distanceKm: distanceResult.distance_km,
      isUrgent: is_urgent,
    })
      .then((result) => result.deliveryFee)
      .catch((error: unknown) => {
        if (error instanceof Error) {
          throw new TaskError(500, error.message);
        }
        throw error;
      });

    if (!(fee_total.gte(0))) {
      throw new TaskError(500, "计算任务费用失败");
    }

    const urgency = input.urgency ?? (is_urgent ? 1 : 0);
    const remark = input.remark ?? null;
    const weight = typeof input.weight === "string" ? input.weight.trim() : "";
    const size = typeof input.size === "string" ? input.size.trim() : "";
    const is_fragile = typeof input.is_fragile === "boolean" ? input.is_fragile : false;
    const need_inspection =
      typeof input.need_inspection === "boolean" ? input.need_inspection : false;

    const scheduled_time = toOptionalDateTime(input.scheduled_time);
    if (input.scheduled_time !== undefined && input.scheduled_time !== null && !scheduled_time) {
      throw new TaskError(400, "scheduled_time 不合法");
    }

    const task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const couponQuote = input.user_coupon_id
        ? await quoteUserCoupon(tx, input.publisherId, input.user_coupon_id, fee_total)
        : null;
      const discountAmount = couponQuote?.discountAmount ?? new Prisma.Decimal(0);
      const payableFee = couponQuote?.payableAmount ?? fee_total;
      const wallet = await tx.userWallet.findUnique({
        where: { user_id: input.publisherId },
        select: { balance: true },
      });

      const balance = wallet?.balance ?? new Prisma.Decimal(0);
      const requiredAmount = payableFee.plus(tip);

      if (balance.lt(requiredAmount)) {
        throw new TaskError(409, "余额不足，无法发布任务");
      }

      const created = await tx.task.create({
        data: {
          publisher_id: input.publisherId,
          pickup_address,
          pickup_lat,
          pickup_lng,
          delivery_address,
          delivery_lat,
          delivery_lng,
          type,
          urgency: typeof urgency === "number" && Number.isFinite(urgency) ? urgency : 0,
          remark,
          images_json: input.images_json as Prisma.InputJsonValue | undefined,
          weight: weight || null,
          size: size || null,
          is_fragile,
          need_inspection,
          is_urgent,
          fee_total: payableFee,
          original_amount: fee_total,
          discount_amount: discountAmount,
          user_coupon_id: input.user_coupon_id || null,
          tip,
          scheduled_time,
          status: scheduled_time ? TaskStatus.SCHEDULED : TaskStatus.PENDING,
        },
      });
      if (input.user_coupon_id) await consumeUserCoupon(tx, input.publisherId, input.user_coupon_id, fee_total, created.id);
      return created;
    }).catch((error) => {
      if (error instanceof CouponError) throw new TaskError(error.status, error.message);
      throw error;
    });

    return task;
  }

  async getTaskList(input: ListTaskInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;
    const type = input.type?.trim();

    const where: Prisma.TaskWhereInput = {
      status: TaskStatus.PENDING,
      ...(type ? { type } : undefined),
    };

    const shouldSortByDistance =
      input.sort === "distance" && Number.isFinite(input.lat) && Number.isFinite(input.lng);

    if (shouldSortByDistance) {
      const lat = Number(input.lat);
      const lng = Number(input.lng);

      const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.delivery_lat - t.pickup_lat) / 2), 2) + COS(RADIANS(t.pickup_lat)) * COS(RADIANS(t.delivery_lat)) * POWER(SIN(RADIANS(t.delivery_lng - t.pickup_lng) / 2), 2)))`;
      const distanceKm = Prisma.sql`ROUND(${distance}, 2)`;

      const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>(
        Prisma.sql`
          SELECT COUNT(*) AS total
          FROM tasks t
          WHERE t.status = ${TaskStatus.PENDING}
            AND t.pickup_lat IS NOT NULL
            AND t.pickup_lng IS NOT NULL
            ${type ? Prisma.sql`AND t.type = ${type}` : Prisma.empty}
        `,
      );
      const total = Number((totalRows[0] as { total: bigint | number } | undefined)?.total ?? 0);

      const items = await prisma.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`
          SELECT t.*, ${distanceKm} AS distance_km
          FROM tasks t
          WHERE t.status = ${TaskStatus.PENDING}
            AND t.pickup_lat IS NOT NULL
            AND t.pickup_lng IS NOT NULL
            ${type ? Prisma.sql`AND t.type = ${type}` : Prisma.empty}
          ORDER BY distance_km ASC, t.created_at DESC
          LIMIT ${pageSize} OFFSET ${skip}
        `,
      );

      const normalizedItems = items.map((it: Record<string, unknown>) => {
        const raw = (it as { distance_km?: unknown }).distance_km;
        const n = typeof raw === "number" ? raw : Number(raw);
        return {
          ...it,
          distance_km: Number.isFinite(n) ? Number(n.toFixed(2)) : null,
        };
      });

      return { page, pageSize, total, items: normalizedItems, list: normalizedItems };
    }

    const orderBy: Prisma.TaskOrderByWithRelationInput =
      input.sort === "reward"
        ? { fee_total: input.sortOrder === "asc" ? "asc" : "desc" }
        : { created_at: "desc" };
    const [total, items] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          food_order: {
            select: {
              id: true,
              order_no: true,
              merchant: { select: { name: true } },
              items: { select: { item_name: true, quantity: true } },
            },
          },
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items,
      list: items,
    };
  }

  async list(input: ListTaskInput) {
    return this.getTaskList(input);
  }

  async detail(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new TaskError(400, "id 不合法");
    }

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new TaskError(404, "任务不存在");
    }

    return task;
  }

  async cancelTask(input: CancelTaskInput) {
    if (!Number.isFinite(input.taskId) || input.taskId <= 0) {
      throw new TaskError(400, "taskId 不合法");
    }
    if (!Number.isFinite(input.publisherId) || input.publisherId <= 0) {
      throw new TaskError(400, "publisherId 不合法");
    }

    const cancelReason =
      typeof input.cancelReason === "string" && input.cancelReason.trim()
        ? input.cancelReason.trim()
        : null;
    const cancelledAt = new Date();

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          status: true,
          publisher_id: true,
          food_order_id: true,
          fee_total: true,
          tip: true,
        },
      });

      if (!task) {
        throw new TaskError(404, "任务不存在");
      }
      if (task.publisher_id !== input.publisherId) {
        throw new TaskError(403, "无权限");
      }
      if (task.food_order_id) {
        throw new TaskError(409, "食堂外卖请在外卖订单中取消");
      }
      if (task.status !== TaskStatus.PENDING) {
        throw new TaskError(409, "任务状态必须为 PENDING 才能取消");
      }

      const amount = task.fee_total.plus(task.tip ?? new Prisma.Decimal(0));
      let refundAmount = new Prisma.Decimal(0);

      if (amount.gt(0)) {
        const wallet = await tx.userWallet.upsert({
          where: { user_id: input.publisherId },
          create: { user_id: input.publisherId },
          update: {},
        });

        const beforeTotal = wallet.balance.plus(wallet.frozen);
        const walletAfterTotal = beforeTotal;

        if (wallet.frozen.gte(amount)) {
          const unfreeze = await tx.userWallet.updateMany({
            where: { id: wallet.id, frozen: { gte: amount } },
            data: {
              frozen: { decrement: amount },
              balance: { increment: refundAmount },
            },
          });
          if (unfreeze.count !== 1) {
            throw new TaskError(409, "冻结金额不足");
          }
          refundAmount = amount;

          await tx.walletLog.create({
            data: {
              wallet_id: wallet.id,
              type: "TASK_CANCEL_REFUND",
              amount: refundAmount,
              ref_order_id: null,
              before_balance: beforeTotal,
              after_balance: walletAfterTotal,
            },
          });
        } else if (wallet.frozen.gt(0)) {
          throw new TaskError(409, "冻结金额不足");
        }
      }

      const updated = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.CANCELLED,
          cancelled_at: cancelledAt,
          cancel_reason: cancelReason,
        },
      });

      await tx.message.create({
        data: {
          user_id: task.publisher_id,
          sender_id: 6,
          sender_name: "系统",
          sender_avatar: "",
          type: "system",
          title: "任务已取消",
          content: `任务 #${task.id} 已取消${refundAmount.gt(0) ? `，已退回 ${refundAmount.toFixed(2)} 元` : ""}${cancelReason ? `。原因：${cancelReason}` : ""}`,
          related_id: task.id,
          conversation_id: `task:${task.id}`,
          is_read: false,
        },
      });

      return { task: updated, refundAmount, platformAmount: new Prisma.Decimal(0) };
    });

    return result;
  }
}
