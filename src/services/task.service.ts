// 解决找不到模块声明文件的问题
// @ts-ignore
import { Prisma, PrismaClient, TaskStatus } from "@prisma/client";

export class TaskError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

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
  fee_total: string | number;
  tip?: string | number | null;
};

type ListTaskInput = {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  sort?: string;
  lat?: number;
  lng?: number;
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

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

export class TaskService {
  async getNearbyTasks(input: { lat: number; lng: number; radius?: number }) {
    const lat = input.lat;
    const lng = input.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TaskError(400, "lat/lng 不合法");
    }

    const radius = Number.isFinite(input.radius) ? Math.max(0.1, Number(input.radius)) : 5;

    const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.pickup_lat - ${lat}) / 2), 2) + COS(RADIANS(${lat})) * COS(RADIANS(t.pickup_lat)) * POWER(SIN(RADIANS(t.pickup_lng - ${lng}) / 2), 2))))`;
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

    const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.pickup_lat - ${lat}) / 2), 2) + COS(RADIANS(${lat})) * COS(RADIANS(t.pickup_lat)) * POWER(SIN(RADIANS(t.pickup_lng - ${lng}) / 2), 2))))`;
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

    const fee_total = toRequiredDecimal(input.fee_total);
    if (!(fee_total.gt(0))) {
      throw new TaskError(400, "fee_total 必须大于 0");
    }

    const tip = toOptionalDecimal(input.tip ?? 0) ?? new Prisma.Decimal(0);
    if (tip.lt(0)) {
      throw new TaskError(400, "tip 不能小于 0");
    }

    const pickup_lat = toOptionalDecimal(input.pickup_lat);
    const pickup_lng = toOptionalDecimal(input.pickup_lng);
    const delivery_lat = toOptionalDecimal(input.delivery_lat);
    const delivery_lng = toOptionalDecimal(input.delivery_lng);

    const urgency = input.urgency ?? 0;
    const remark = input.remark ?? null;

    const task = await prisma.task.create({
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
        fee_total,
        tip,
        status: TaskStatus.PENDING,
      },
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

      const distance = Prisma.sql`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(t.pickup_lat - ${lat}) / 2), 2) + COS(RADIANS(${lat})) * COS(RADIANS(t.pickup_lat)) * POWER(SIN(RADIANS(t.pickup_lng - ${lng}) / 2), 2))))`;
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

      return { page, pageSize, total, items: normalizedItems };
    }

    const [total, items] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({ where, orderBy: { created_at: "desc" }, skip, take: pageSize }),
    ]);

    return {
      page,
      pageSize,
      total,
      items,
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

  async cancelTask(input: { taskId: number; publisherId: number }) {
    if (!Number.isFinite(input.taskId) || input.taskId <= 0) {
      throw new TaskError(400, "taskId 不合法");
    }
    if (!Number.isFinite(input.publisherId) || input.publisherId <= 0) {
      throw new TaskError(400, "publisherId 不合法");
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          status: true,
          publisher_id: true,
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
      if (task.status !== TaskStatus.PENDING) {
        throw new TaskError(409, "任务状态必须为 PENDING");
      }

      const amount = task.fee_total.plus(task.tip ?? new Prisma.Decimal(0));

      const wallet = await tx.userWallet.upsert({
        where: { user_id: input.publisherId },
        create: { user_id: input.publisherId },
        update: {},
      });

      const beforeTotal = wallet.balance.plus(wallet.frozen);
      const afterTotal = beforeTotal;

      let refundAmount = new Prisma.Decimal(0);

      if (wallet.frozen.gte(amount)) {
        const unfreeze = await tx.userWallet.updateMany({
          where: { id: wallet.id, frozen: { gte: amount } },
          data: { frozen: { decrement: amount }, balance: { increment: amount } },
        });
        if (unfreeze.count !== 1) {
          throw new TaskError(409, "冻结金额不足");
        }

        await tx.walletLog.create({
          data: {
            wallet_id: wallet.id,
            type: "TASK_CANCEL_REFUND",
            amount,
            ref_order_id: null,
            before_balance: beforeTotal,
            after_balance: afterTotal,
          },
        });

        refundAmount = amount;
      } else if (wallet.frozen.gt(0)) {
        throw new TaskError(409, "冻结金额不足");
      }

      const updated = await tx.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.CANCELLED },
      });

      return { task: updated, refundAmount };
    });

    return result;
  }
}
