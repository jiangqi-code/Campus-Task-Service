import { ComplaintStatus, OrderStatus, Prisma, PrismaClient, Role, TaskStatus } from "@prisma/client";
import { WithdrawStatus } from "./withdraw.service";
import { notificationService } from "./notification.service";
import { sensitiveWordService } from "./sensitiveWord.service";
import { creditService } from "./credit.service";
import bcrypt from "bcryptjs";

export class AdminError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

export const setRunnerInitialCreditScore = async (tx: Prisma.TransactionClient, userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user || user.status === -1) return null;
  return tx.user.update({ where: { id: userId }, data: { credit_score: 100 } });
};

export const approveRunnerAuth = async (tx: Prisma.TransactionClient, userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user || user.status === -1) return null;
  return tx.user.update({ where: { id: userId }, data: { role: Role.RUNNER, credit_score: 100 } });
};

type CancelOrderInput = {
  adminId: number;
  orderId: number;
  reason?: string | null;
};

type SetOrderStatusInput = {
  adminId: number;
  orderId: number;
  status: OrderStatus;
  reason?: string | null;
};

type ListWithdrawInput = {
  page?: number;
  pageSize?: number;
  status?: string;
};

type AuditWithdrawInput = {
  adminId: number;
  withdrawId: number;
  decision: "APPROVE" | "REJECT";
  reason?: string | null;
};

type UserListInput = {
  page?: unknown;
  pageSize?: unknown;
  keyword?: unknown;
  role?: unknown;
  status?: unknown;
};

type FreezeUserInput = {
  adminId: number;
  userId: number;
  action: "freeze" | "unfreeze";
};

type DeleteUserInput = {
  adminId: number;
  userId: number;
};

type ResetPasswordInput = {
  adminId: number;
  userId: number;
};

type ProcessComplaintInput = {
  adminId: number;
  complaintId: number;
  action: unknown;
  admin_note?: unknown;
};

type OrderListInput = {
  adminId: number;
  page?: unknown;
  pageSize?: unknown;
  keyword?: unknown;
  status?: unknown;
};

type TaskListInput = {
  adminId: number;
  page?: unknown;
  pageSize?: unknown;
  keyword?: unknown;
  status?: unknown;
  type?: unknown;
  publisherId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

type DeleteTaskInput = {
  adminId: number;
  taskId: number;
};

type AdminLogListInput = {
  page?: unknown;
  pageSize?: unknown;
  adminId?: unknown;
  action?: unknown;
  targetType?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

type LoginLogListInput = {
  page?: unknown;
  pageSize?: unknown;
  userId?: unknown;
  keyword?: unknown;
  ip?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

type ErrorLogListInput = {
  page?: unknown;
  pageSize?: unknown;
  userId?: unknown;
  keyword?: unknown;
  url?: unknown;
  method?: unknown;
  ip?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

type HeatmapInput = {
  startDate?: unknown;
  endDate?: unknown;
};

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const hasQueryValue = (value: unknown) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  return true;
};

const toOptionalPositiveInt = (value: unknown) => {
  if (!hasQueryValue(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }
  return null;
};

const toOptionalTrimmedString = (value: unknown) => {
  if (!hasQueryValue(value)) return null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
};

const toOptionalStartDate = (value: unknown) => {
  const s = toOptionalTrimmedString(value);
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T00:00:00` : s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const toOptionalEndDate = (value: unknown) => {
  const s = toOptionalTrimmedString(value);
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T23:59:59.999` : s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const isOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (Object.values(OrderStatus) as string[]).includes(value);
};

const isAdminListableOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (
    value === OrderStatus.ACCEPTED ||
    value === OrderStatus.PICKED ||
    value === OrderStatus.DELIVERING ||
    value === OrderStatus.COMPLETED ||
    value === OrderStatus.CANCELLED
  );
};

const toRole = (value: unknown): Role | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const all = Object.values(Role) as string[];
  if (all.includes(normalized)) return normalized as Role;
  return null;
};

const toUserStatus = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n === 0 || n === 1) return n;
    return null;
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "1" || normalized === "normal" || normalized === "active" || normalized === "enabled" || normalized === "正常") {
    return 1;
  }
  if (normalized === "0" || normalized === "frozen" || normalized === "freeze" || normalized === "disabled" || normalized === "冻结") {
    return 0;
  }
  return null;
};

const toFreezeAction = (value: unknown): "freeze" | "unfreeze" | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "freeze") return "freeze";
  if (normalized === "unfreeze") return "unfreeze";
  return null;
};

const toTaskStatus = (value: unknown): TaskStatus | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const all = Object.values(TaskStatus) as string[];
  if (all.includes(normalized)) return normalized as TaskStatus;
  return null;
};

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

type ComplaintProcessAction = "resolve" | "reject";

const toComplaintProcessAction = (value: unknown): ComplaintProcessAction | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "resolve" || v === "reject") return v;
  return null;
};

const toOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return v ? v : undefined;
};

const roundMoney = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const isSevereComplaint = (reason: string) => {
  const v = reason.trim();
  if (!v) return false;
  return /严重|重大|恶劣|serious|severe/i.test(v);
};

const sensitiveWordsConfigKey = "sensitive_words";

const parseSensitiveWordsConfigValue = (raw: string): string[] => {
  const value = raw.trim();
  if (!value) return [];

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
        return Array.from(new Set(normalized));
      }
    } catch {
      return [];
    }
  }

  const fallback = value
    .split(/[\r\n,;，；\t ]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  return Array.from(new Set(fallback));
};

const toOrderStatusUpdate = (nextStatus: OrderStatus) => {
  const now = new Date();
  if (nextStatus === OrderStatus.ACCEPTED) {
    return { status: nextStatus, accept_time: now };
  }
  if (nextStatus === OrderStatus.PICKED) {
    return { status: nextStatus, pickup_time: now };
  }
  if (nextStatus === OrderStatus.DELIVERING) {
    return { status: nextStatus, delivery_time: now };
  }
  if (nextStatus === OrderStatus.COMPLETED) {
    return { status: nextStatus, complete_time: now };
  }
  if (nextStatus === OrderStatus.CANCELLED) {
    return { status: nextStatus };
  }
  return { status: nextStatus };
};

export class AdminService {
  async getDashboard() {
    const now = new Date();

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const day = todayStart.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - diffToMonday);
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const activeStart = new Date(todayStart);
    activeStart.setDate(activeStart.getDate() - 6);

    const [todayOrders, weekOrders, monthOrders, totalOrders] = await Promise.all([
      prisma.order.count({ where: { created_at: { gte: todayStart, lt: tomorrowStart } } }),
      prisma.order.count({ where: { created_at: { gte: weekStart, lt: nextWeekStart } } }),
      prisma.order.count({ where: { created_at: { gte: monthStart, lt: nextMonthStart } } }),
      prisma.order.count(),
    ]);

    const [todayAmountAgg, weekAmountAgg, monthAmountAgg, totalAmountAgg] = await Promise.all([
      prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED, complete_time: { gte: todayStart, lt: tomorrowStart } },
        _sum: { final_price: true },
      }),
      prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED, complete_time: { gte: weekStart, lt: nextWeekStart } },
        _sum: { final_price: true },
      }),
      prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED, complete_time: { gte: monthStart, lt: nextMonthStart } },
        _sum: { final_price: true },
      }),
      prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED },
        _sum: { final_price: true },
      }),
    ]);

    const todayAmount = todayAmountAgg._sum.final_price ?? new Prisma.Decimal(0);
    const weekAmount = weekAmountAgg._sum.final_price ?? new Prisma.Decimal(0);
    const monthAmount = monthAmountAgg._sum.final_price ?? new Prisma.Decimal(0);
    const totalAmount = totalAmountAgg._sum.final_price ?? new Prisma.Decimal(0);

    const [totalUsers, todayNewUsers] = await Promise.all([
      prisma.user.count({ where: { status: { not: -1 } } }),
      prisma.user.count({ where: { status: { not: -1 }, created_at: { gte: todayStart, lt: tomorrowStart } } }),
    ]);

    const activePublishers = await prisma.task.findMany({
      where: { orders: { some: { created_at: { gte: activeStart }, status: { not: OrderStatus.CANCELLED } } } },
      select: { publisher_id: true },
      distinct: ["publisher_id"],
    });
    const activeUsers = activePublishers.length;

    const topEarningRows = await prisma.earning.groupBy({
      by: ["user_id"],
      where: { type: "ORDER", status: "SETTLED" },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 10,
    });

    const topUserIds = topEarningRows.map((r) => r.user_id);

    const [topUsers, completedRows] = await Promise.all([
      topUserIds.length
        ? prisma.user.findMany({ where: { id: { in: topUserIds } }, select: { id: true, nickname: true } })
        : Promise.resolve([]),
      topUserIds.length
        ? prisma.order.groupBy({
            by: ["taker_id"],
            where: { status: OrderStatus.COMPLETED, taker_id: { in: topUserIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const userIdToNickname = new Map<number, string>();
    for (const u of topUsers) {
      userIdToNickname.set(u.id, u.nickname ?? "");
    }

    const userIdToCompleted = new Map<number, number>();
    for (const row of completedRows) {
      const userId = row.taker_id;
      if (!userId) continue;
      userIdToCompleted.set(userId, row._count._all ?? 0);
    }

    const runnerRanking = topEarningRows.map((r, i) => ({
      rank: i + 1,
      user_id: r.user_id,
      nickname: userIdToNickname.get(r.user_id) ?? "",
      totalEarning: r._sum.amount ?? new Prisma.Decimal(0),
      completedOrders: userIdToCompleted.get(r.user_id) ?? 0,
    }));

    return {
      orderStats: { todayOrders, weekOrders, monthOrders, totalOrders },
      amountStats: { todayAmount, weekAmount, monthAmount, totalAmount },
      userStats: { totalUsers, todayNewUsers, activeUsers },
      runnerRanking,
    };
  }

  async getHeatmapData(input: HeatmapInput) {
    const startDate = toOptionalStartDate(input.startDate);
    if (hasQueryValue(input.startDate) && !startDate) {
      throw new AdminError(400, "start_date 不合法");
    }

    const endDate = toOptionalEndDate(input.endDate);
    if (hasQueryValue(input.endDate) && !endDate) {
      throw new AdminError(400, "end_date 不合法");
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      throw new AdminError(400, "start_date 不能大于 end_date");
    }

    const where: Prisma.OrderWhereInput = {
      task: { pickup_lat: { not: null }, pickup_lng: { not: null } },
      ...((startDate || endDate) && {
        created_at: {
          ...(startDate ? { gte: startDate } : undefined),
          ...(endDate ? { lte: endDate } : undefined),
        },
      }),
    };

    const grouped = await prisma.order.groupBy({
      by: ["task_id"],
      where,
      _count: { _all: true },
    });

    if (!grouped.length) return [];

    const taskIds = grouped.map((r) => r.task_id);

    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, pickup_lat: true, pickup_lng: true },
    });

    const taskIdToCoords = new Map<number, { lat: Prisma.Decimal; lng: Prisma.Decimal }>();
    for (const t of tasks) {
      if (!t.pickup_lat || !t.pickup_lng) continue;
      taskIdToCoords.set(t.id, { lat: t.pickup_lat, lng: t.pickup_lng });
    }

    const agg = new Map<string, { lat: number; lng: number; count: number }>();
    for (const row of grouped) {
      const coords = taskIdToCoords.get(row.task_id);
      if (!coords) continue;

      const count = row._count._all ?? 0;
      if (!count) continue;

      const latStr = coords.lat.toFixed(6);
      const lngStr = coords.lng.toFixed(6);
      const key = `${latStr},${lngStr}`;

      const existing = agg.get(key);
      if (existing) {
        existing.count += count;
        continue;
      }

      agg.set(key, {
        lat: Number(latStr),
        lng: Number(lngStr),
        count,
      });
    }

    return Array.from(agg.values());
  }

  async getLogs(input: AdminLogListInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const adminId = toOptionalPositiveInt(input.adminId);
    if (hasQueryValue(input.adminId) && !adminId) {
      throw new AdminError(400, "admin_id 不合法");
    }

    const action = toOptionalTrimmedString(input.action);
    if (hasQueryValue(input.action) && !action) {
      throw new AdminError(400, "action 不合法");
    }

    const targetType = toOptionalTrimmedString(input.targetType);
    if (hasQueryValue(input.targetType) && !targetType) {
      throw new AdminError(400, "target_type 不合法");
    }

    const startDate = toOptionalStartDate(input.startDate);
    if (hasQueryValue(input.startDate) && !startDate) {
      throw new AdminError(400, "start_date 不合法");
    }

    const endDate = toOptionalEndDate(input.endDate);
    if (hasQueryValue(input.endDate) && !endDate) {
      throw new AdminError(400, "end_date 不合法");
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      throw new AdminError(400, "start_date 不能大于 end_date");
    }

    const where: Prisma.AdminLogWhereInput = {
      ...(adminId ? { admin_id: adminId } : undefined),
      ...(action ? { action } : undefined),
      ...(targetType ? { target_type: targetType } : undefined),
      ...((startDate || endDate) && {
        created_at: {
          ...(startDate ? { gte: startDate } : undefined),
          ...(endDate ? { lte: endDate } : undefined),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      prisma.adminLog.count({ where }),
      prisma.adminLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          admin_id: true,
          action: true,
          target_type: true,
          target_id: true,
          detail_json: true,
          created_at: true,
          admin: { select: { nickname: true, student_id: true, phone: true } },
        },
      }),
    ]);

    const items = rows.map((row: any) => ({
      admin_id: row.admin_id,
      admin_name: row.admin.nickname ?? row.admin.student_id ?? row.admin.phone ?? "",
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      detail_json: row.detail_json,
      created_at: row.created_at,
    }));

    return { page, pageSize, total, items };
  }

  async getLoginLogs(input: LoginLogListInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const userId = toOptionalPositiveInt(input.userId);
    if (hasQueryValue(input.userId) && !userId) {
      throw new AdminError(400, "user_id 不合法");
    }

    const keyword = toOptionalTrimmedString(input.keyword);
    if (hasQueryValue(input.keyword) && !keyword) {
      throw new AdminError(400, "keyword 不合法");
    }

    const ip = toOptionalTrimmedString(input.ip);
    if (hasQueryValue(input.ip) && !ip) {
      throw new AdminError(400, "ip 不合法");
    }

    const startDate = toOptionalStartDate(input.startDate);
    if (hasQueryValue(input.startDate) && !startDate) {
      throw new AdminError(400, "start_date 不合法");
    }

    const endDate = toOptionalEndDate(input.endDate);
    if (hasQueryValue(input.endDate) && !endDate) {
      throw new AdminError(400, "end_date 不合法");
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      throw new AdminError(400, "start_date 不能大于 end_date");
    }

    const where: Prisma.LoginLogWhereInput = {
      ...(userId ? { user_id: userId } : undefined),
      ...(ip ? { ip: { contains: ip } } : undefined),
      ...(keyword
        ? {
            user: {
              OR: [
                { student_id: { contains: keyword } },
                { phone: { contains: keyword } },
                { nickname: { contains: keyword } },
              ],
            },
          }
        : undefined),
      ...((startDate || endDate) && {
        login_time: {
          ...(startDate ? { gte: startDate } : undefined),
          ...(endDate ? { lte: endDate } : undefined),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      prisma.loginLog.count({ where }),
      prisma.loginLog.findMany({
        where,
        orderBy: { login_time: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          user_id: true,
          login_time: true,
          ip: true,
          user_agent: true,
          user: { select: { nickname: true, student_id: true, phone: true, role: true } },
        },
      }),
    ]);

    const items = rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      user_name: row.user.nickname ?? row.user.student_id ?? row.user.phone ?? "",
      role: row.user.role,
      login_time: row.login_time,
      ip: row.ip,
      user_agent: row.user_agent,
    }));

    return { page, pageSize, total, items };
  }

  async getErrorLogs(input: ErrorLogListInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const userId = toOptionalPositiveInt(input.userId);
    if (hasQueryValue(input.userId) && !userId) {
      throw new AdminError(400, "user_id 不合法");
    }

    const keyword = toOptionalTrimmedString(input.keyword);
    if (hasQueryValue(input.keyword) && !keyword) {
      throw new AdminError(400, "keyword 不合法");
    }

    const url = toOptionalTrimmedString(input.url);
    if (hasQueryValue(input.url) && !url) {
      throw new AdminError(400, "url 不合法");
    }

    const methodRaw = toOptionalTrimmedString(input.method);
    if (hasQueryValue(input.method) && !methodRaw) {
      throw new AdminError(400, "method 不合法");
    }
    const method = methodRaw ? methodRaw.trim().toUpperCase() : null;

    const ip = toOptionalTrimmedString(input.ip);
    if (hasQueryValue(input.ip) && !ip) {
      throw new AdminError(400, "ip 不合法");
    }

    const startDate = toOptionalStartDate(input.startDate);
    if (hasQueryValue(input.startDate) && !startDate) {
      throw new AdminError(400, "start_date 不合法");
    }

    const endDate = toOptionalEndDate(input.endDate);
    if (hasQueryValue(input.endDate) && !endDate) {
      throw new AdminError(400, "end_date 不合法");
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      throw new AdminError(400, "start_date 不能大于 end_date");
    }

    const where: Prisma.ErrorLogWhereInput = {
      ...(userId ? { user_id: userId } : undefined),
      ...(ip ? { ip: { contains: ip } } : undefined),
      ...(url ? { url: { contains: url } } : undefined),
      ...(method ? { method } : undefined),
      ...(keyword
        ? {
            OR: [{ error_message: { contains: keyword } }, { stack: { contains: keyword } }],
          }
        : undefined),
      ...((startDate || endDate) && {
        created_at: {
          ...(startDate ? { gte: startDate } : undefined),
          ...(endDate ? { lte: endDate } : undefined),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      prisma.errorLog.count({ where }),
      prisma.errorLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          error_message: true,
          stack: true,
          url: true,
          method: true,
          ip: true,
          user_id: true,
          created_at: true,
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      error_message: row.error_message,
      stack: row.stack,
      url: row.url,
      method: row.method,
      ip: row.ip,
      user_id: row.user_id,
      created_at: row.created_at,
    }));

    return { page, pageSize, total, items };
  }

  async userList(input: UserListInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const keyword = typeof input.keyword === "string" ? input.keyword.trim() : "";
    const role = toRole(input.role);
    const status = toUserStatus(input.status);

    const where: Prisma.UserWhereInput = {};

    if (status !== null) {
      where.status = status;
    } else {
      where.status = { not: -1 };
    }

    if (role) {
      where.role = role;
    }

    if (keyword) {
      where.OR = [
        { student_id: { contains: keyword } },
        { nickname: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          student_id: true,
          phone: true,
          nickname: true,
          role: true,
          status: true,
          credit_score: true,
          created_at: true,
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async freezeUser(input: FreezeUserInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new AdminError(400, "userId 不合法");
    }

    const action = toFreezeAction(input.action);
    if (!action) {
      throw new AdminError(400, "action 不合法");
    }

    const nextStatus = action === "freeze" ? 0 : 1;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, role: true, student_id: true, phone: true, nickname: true },
      });
      if (!user) {
        throw new AdminError(404, "用户不存在");
      }
      if (user.status === -1) {
        throw new AdminError(409, "用户已删除");
      }

      if (user.status === nextStatus) {
        return user;
      }

      const next = await tx.user.update({
        where: { id: input.userId },
        data: { status: nextStatus },
        select: { id: true, status: true, role: true, student_id: true, phone: true, nickname: true },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: action === "freeze" ? "USER_FREEZE" : "USER_UNFREEZE",
          target_type: "USER",
          target_id: input.userId,
          detail_json: toAdminLogDetail({
            from_status: user.status,
            to_status: nextStatus,
            at: now.toISOString(),
          }),
        },
      });

      return next;
    });

    return updated;
  }

  async deleteUser(input: DeleteUserInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new AdminError(400, "userId 不合法");
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true },
      });
      if (!user) {
        throw new AdminError(404, "用户不存在");
      }

      if (user.status === -1) {
        return { userId: user.id, deleted: true };
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { status: -1 },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "USER_DELETE",
          target_type: "USER",
          target_id: input.userId,
          detail_json: toAdminLogDetail({
            from_status: user.status,
            to_status: -1,
            at: now.toISOString(),
          }),
        },
      });

      return { userId: input.userId, deleted: true };
    });

    return result;
  }

  async resetPassword(input: ResetPasswordInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new AdminError(400, "userId 不合法");
    }

    const now = new Date();
    const defaultPassword = "123456";
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true },
      });
      if (!user) {
        throw new AdminError(404, "用户不存在");
      }
      if (user.status === -1) {
        throw new AdminError(409, "用户已删除");
      }

      await tx.user.update({
        where: { id: input.userId },
        data: { password_hash: passwordHash },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "USER_RESET_PASSWORD",
          target_type: "USER",
          target_id: input.userId,
          detail_json: toAdminLogDetail({
            at: now.toISOString(),
            to_default: true,
          }),
        },
      });

      return { userId: input.userId, reset: true };
    });

    return result;
  }

  async cancelOrder(input: CancelOrderInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new AdminError(400, "orderId 不合法");
    }

    const reason = input.reason ?? null;
    const now = new Date();
    let fromStatus: OrderStatus | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          task_id: true,
          status: true,
          final_price: true,
          task: { select: { publisher_id: true, fee_total: true, tip: true, status: true } },
        },
      });
      if (!order) {
        throw new AdminError(404, "订单不存在");
      }

      fromStatus = order.status;

      if (order.status === OrderStatus.CANCELLED) {
        return tx.order.findUnique({ where: { id: input.orderId } });
      }

      const settled = await tx.earning.findFirst({
        where: { order_id: input.orderId, type: "ORDER", status: "SETTLED" },
        select: { id: true },
      });
      if (settled) {
        throw new AdminError(409, "订单已结算，无法取消");
      }

      const computed = order.task.fee_total.plus(order.task.tip ?? new Prisma.Decimal(0));
      const amount = order.final_price ?? computed;
      if (!amount || !amount.gt(0)) {
        throw new AdminError(400, "final_price 不合法");
      }

      const publisherWallet = await tx.userWallet.upsert({
        where: { user_id: order.task.publisher_id },
        create: { user_id: order.task.publisher_id },
        update: {},
      });

      const publisherBeforeTotal = publisherWallet.balance.plus(publisherWallet.frozen);
      const publisherAfterTotal = publisherBeforeTotal;

      const refund = await tx.userWallet.updateMany({
        where: { id: publisherWallet.id, frozen: { gte: amount } },
        data: { frozen: { decrement: amount }, balance: { increment: amount } },
      });
      if (refund.count !== 1) {
        throw new AdminError(409, "发布者冻结金额不足");
      }

      await tx.walletLog.create({
        data: {
          wallet_id: publisherWallet.id,
          type: "ORDER_CANCEL_REFUND",
          amount,
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

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "ORDER_CANCEL",
          target_type: "ORDER",
          target_id: order.id,
          detail_json: toAdminLogDetail({
            reason,
            from_status: order.status,
            to_status: OrderStatus.CANCELLED,
            task_id: order.task_id,
            refund_amount: String(amount),
            at: now.toISOString(),
          }),
        },
      });

      return nextOrder;
    });

    if (!updated) {
      throw new AdminError(500, "订单更新失败");
    }

    if (fromStatus) {
      notificationService
        .notifyOrderStatusChanged({ orderId: updated.id, fromStatus, toStatus: updated.status })
        .catch(() => {});
    }

    return updated;
  }

  async setOrderStatus(input: SetOrderStatusInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new AdminError(400, "orderId 不合法");
    }
    if (!isOrderStatus(input.status)) {
      throw new AdminError(400, "status 不合法");
    }

    const reason = input.reason ?? null;
    const now = new Date();
    let fromStatus: OrderStatus | null = null;

    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, status: true },
      });
      if (!current) {
        throw new AdminError(404, "订单不存在");
      }

      fromStatus = current.status;

      const settled = await tx.earning.findFirst({
        where: { order_id: input.orderId, type: "ORDER", status: "SETTLED" },
        select: { id: true },
      });
      if (settled && current.status !== input.status) {
        throw new AdminError(409, "订单已结算，无法修改状态");
      }

      const nextOrder = await tx.order.update({
        where: { id: input.orderId },
        data: toOrderStatusUpdate(input.status),
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "ORDER_SET_STATUS",
          target_type: "ORDER",
          target_id: input.orderId,
          detail_json: toAdminLogDetail({
            reason,
            from_status: current.status,
            to_status: input.status,
            at: now.toISOString(),
          }),
        },
      });

      return nextOrder;
    });

    if (fromStatus) {
      notificationService
        .notifyOrderStatusChanged({ orderId: order.id, fromStatus, toStatus: order.status })
        .catch(() => {});
    }

    return order;
  }

  async orderList(input: OrderListInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const keyword = typeof input.keyword === "string" ? input.keyword.trim() : "";
    const statusRaw = typeof input.status === "string" ? input.status.trim() : "";
    if (statusRaw && !isAdminListableOrderStatus(statusRaw)) {
      throw new AdminError(400, "status 不合法");
    }
    const status = statusRaw ? (statusRaw as OrderStatus) : null;

    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : undefined),
    };

    if (keyword) {
      const or: Prisma.OrderWhereInput[] = [];

      if (/^\d+$/.test(keyword)) {
        const id = Number.parseInt(keyword, 10);
        if (Number.isFinite(id) && id > 0) {
          or.push({ id });
        }
      }

      or.push({
        task: {
          OR: [
            { pickup_address: { contains: keyword } },
            { delivery_address: { contains: keyword } },
          ],
        },
      });

      where.OR = or;
    }

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          task_id: true,
          taker_id: true,
          status: true,
          final_price: true,
          created_at: true,
          task: {
            select: {
              id: true,
              publisher_id: true,
              pickup_address: true,
              delivery_address: true,
              type: true,
              urgency: true,
              remark: true,
              images_json: true,
              fee_total: true,
              tip: true,
              status: true,
              created_at: true,
            },
          },
          taker: {
            select: {
              id: true,
              student_id: true,
              phone: true,
              nickname: true,
              role: true,
              status: true,
              created_at: true,
            },
          },
        },
      }),
    ]);

    await prisma.adminLog.create({
      data: {
        admin_id: input.adminId,
        action: "ORDER_LIST",
        target_type: "ORDER",
        target_id: null,
        detail_json: toAdminLogDetail({
          page,
          pageSize,
          keyword: keyword || null,
          status: status ?? null,
          total,
          returned: items.length,
          at: new Date().toISOString(),
        }),
      },
    });

    return { page, pageSize, total, items };
  }

  async getTaskList(input: TaskListInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const keyword = typeof input.keyword === "string" ? input.keyword.trim() : "";

    const status = toTaskStatus(input.status);
    if (hasQueryValue(input.status) && !status) {
      throw new AdminError(400, "status 不合法");
    }

    const type = toOptionalTrimmedString(input.type);
    if (hasQueryValue(input.type) && !type) {
      throw new AdminError(400, "type 不合法");
    }

    const publisherId = toOptionalPositiveInt(input.publisherId);
    if (hasQueryValue(input.publisherId) && !publisherId) {
      throw new AdminError(400, "publisher_id 不合法");
    }

    const startDate = toOptionalStartDate(input.startDate);
    if (hasQueryValue(input.startDate) && !startDate) {
      throw new AdminError(400, "start_date 不合法");
    }

    const endDate = toOptionalEndDate(input.endDate);
    if (hasQueryValue(input.endDate) && !endDate) {
      throw new AdminError(400, "end_date 不合法");
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      throw new AdminError(400, "start_date 不能大于 end_date");
    }

    const where: Prisma.TaskWhereInput = {
      ...(status ? { status } : undefined),
      ...(type ? { type } : undefined),
      ...(publisherId ? { publisher_id: publisherId } : undefined),
      ...((startDate || endDate) && {
        created_at: {
          ...(startDate ? { gte: startDate } : undefined),
          ...(endDate ? { lte: endDate } : undefined),
        },
      }),
    };

    if (keyword) {
      const or: Prisma.TaskWhereInput[] = [];

      if (/^\d+$/.test(keyword)) {
        const id = Number.parseInt(keyword, 10);
        if (Number.isFinite(id) && id > 0) {
          or.push({ id });
          or.push({ publisher_id: id });
        }
      }

      or.push({ pickup_address: { contains: keyword } });
      or.push({ delivery_address: { contains: keyword } });
      or.push({ remark: { contains: keyword } });
      or.push({
        publisher: {
          OR: [
            { student_id: { contains: keyword } },
            { phone: { contains: keyword } },
            { nickname: { contains: keyword } },
          ],
        },
      });

      where.OR = or;
    }

    const [total, items] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          publisher_id: true,
          pickup_address: true,
          delivery_address: true,
          type: true,
          urgency: true,
          remark: true,
          images_json: true,
          fee_total: true,
          tip: true,
          status: true,
          created_at: true,
          publisher: {
            select: { id: true, student_id: true, phone: true, nickname: true, role: true, status: true },
          },
          _count: { select: { orders: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async deleteTask(input: DeleteTaskInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.taskId) || input.taskId <= 0) {
      throw new AdminError(400, "taskId 不合法");
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          publisher_id: true,
          pickup_address: true,
          delivery_address: true,
          type: true,
          urgency: true,
          remark: true,
          fee_total: true,
          tip: true,
          status: true,
          created_at: true,
        },
      });
      if (!task) {
        throw new AdminError(404, "任务不存在");
      }

      const ordersCount = await tx.order.count({ where: { task_id: task.id } });

      await tx.task.delete({ where: { id: task.id } });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "TASK_DELETE",
          target_type: "TASK",
          target_id: task.id,
          detail_json: toAdminLogDetail({
            task,
            orders_count: ordersCount,
            at: now.toISOString(),
          }),
        },
      });

      return { taskId: task.id, deleted: true };
    });

    return result;
  }

  async listWithdraws(input: ListWithdrawInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const status = typeof input.status === "string" && input.status.trim() ? input.status.trim() : undefined;

    const where: Prisma.WithdrawWhereInput = {
      ...(status ? { status } : undefined),
    };

    const [total, items] = await Promise.all([
      prisma.withdraw.count({ where }),
      prisma.withdraw.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          user: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          audit_admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async auditWithdraw(input: AuditWithdrawInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.withdrawId) || input.withdrawId <= 0) {
      throw new AdminError(400, "withdrawId 不合法");
    }

    const reason = input.reason ?? null;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const withdraw = await tx.withdraw.findUnique({
        where: { id: input.withdrawId },
        select: { id: true, user_id: true, amount: true, status: true },
      });
      if (!withdraw) {
        throw new AdminError(404, "提现申请不存在");
      }
      if (withdraw.status !== WithdrawStatus.PENDING) {
        throw new AdminError(409, "提现申请状态不是 PENDING");
      }

      const wallet = await tx.userWallet.upsert({
        where: { user_id: withdraw.user_id },
        create: { user_id: withdraw.user_id },
        update: {},
      });

      const beforeTotal = wallet.balance.plus(wallet.frozen);

      if (input.decision === "APPROVE") {
        const afterTotal = beforeTotal.minus(withdraw.amount);

        const frozenUpdate = await tx.userWallet.updateMany({
          where: { id: wallet.id, frozen: { gte: withdraw.amount } },
          data: { frozen: { decrement: withdraw.amount } },
        });
        if (frozenUpdate.count !== 1) {
          throw new AdminError(409, "冻结金额不足");
        }

        await tx.walletLog.create({
          data: {
            wallet_id: wallet.id,
            type: "WITHDRAW_APPROVE_OUT",
            amount: withdraw.amount,
            ref_order_id: null,
            before_balance: beforeTotal,
            after_balance: afterTotal,
          },
        });

        const next = await tx.withdraw.update({
          where: { id: withdraw.id },
          data: {
            status: WithdrawStatus.APPROVED,
            audit_time: now,
            audit_admin_id: input.adminId,
          },
        });

        await tx.adminLog.create({
          data: {
            admin_id: input.adminId,
            action: "WITHDRAW_AUDIT",
            target_type: "WITHDRAW",
            target_id: withdraw.id,
            detail_json: toAdminLogDetail({
              decision: input.decision,
              reason,
              user_id: withdraw.user_id,
              amount: String(withdraw.amount),
              to_status: WithdrawStatus.APPROVED,
              at: now.toISOString(),
            }),
          },
        });

        return next;
      }

      const afterTotal = beforeTotal;

      const returnUpdate = await tx.userWallet.updateMany({
        where: { id: wallet.id, frozen: { gte: withdraw.amount } },
        data: { frozen: { decrement: withdraw.amount }, balance: { increment: withdraw.amount } },
      });
      if (returnUpdate.count !== 1) {
        throw new AdminError(409, "冻结金额不足");
      }

      await tx.walletLog.create({
        data: {
          wallet_id: wallet.id,
          type: "WITHDRAW_REJECT_RETURN",
          amount: withdraw.amount,
          ref_order_id: null,
          before_balance: beforeTotal,
          after_balance: afterTotal,
        },
      });

      const next = await tx.withdraw.update({
        where: { id: withdraw.id },
        data: {
          status: WithdrawStatus.REJECTED,
          audit_time: now,
          audit_admin_id: input.adminId,
        },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "WITHDRAW_AUDIT",
          target_type: "WITHDRAW",
          target_id: withdraw.id,
          detail_json: toAdminLogDetail({
            decision: input.decision,
            reason,
            user_id: withdraw.user_id,
            amount: String(withdraw.amount),
            to_status: WithdrawStatus.REJECTED,
            at: now.toISOString(),
          }),
        },
      });

      return next;
    });

    return updated;
  }

  async getSensitiveWords(input: { adminId: number }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const row = await prisma.systemConfig.findUnique({
      where: { key: sensitiveWordsConfigKey },
      select: { value: true, updated_at: true },
    });

    const words = parseSensitiveWordsConfigValue(row?.value ?? "");

    await prisma.adminLog.create({
      data: {
        admin_id: input.adminId,
        action: "SENSITIVE_WORD_LIST",
        target_type: "SYSTEM_CONFIG",
        target_id: null,
        detail_json: toAdminLogDetail({
          key: sensitiveWordsConfigKey,
          total: words.length,
          updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
          at: new Date().toISOString(),
        }),
      },
    });

    return { items: words };
  }

  async addSensitiveWord(input: { adminId: number; word: string }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const word = typeof input.word === "string" ? input.word.trim() : "";
    if (!word) {
      throw new AdminError(400, "word 不合法");
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const beforeRow = await tx.systemConfig.findUnique({
        where: { key: sensitiveWordsConfigKey },
        select: { value: true },
      });

      const before = parseSensitiveWordsConfigValue(beforeRow?.value ?? "");
      const exists = before.some((w) => w === word || w.toLowerCase() === word.toLowerCase());
      if (exists) {
        throw new AdminError(409, "敏感词已存在");
      }

      const next = [...before, word];
      const nextValue = JSON.stringify(next);

      const updated = await tx.systemConfig.upsert({
        where: { key: sensitiveWordsConfigKey },
        create: { key: sensitiveWordsConfigKey, value: nextValue },
        update: { value: nextValue },
        select: { key: true, value: true, updated_at: true },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "SENSITIVE_WORD_ADD",
          target_type: "SYSTEM_CONFIG",
          target_id: null,
          detail_json: toAdminLogDetail({
            key: sensitiveWordsConfigKey,
            added: word,
            before_total: before.length,
            after_total: next.length,
            at: now.toISOString(),
          }),
        },
      });

      return { updated, items: next };
    });

    sensitiveWordService.invalidate();

    return { items: result.items };
  }

  async deleteSensitiveWord(input: { adminId: number; id: string }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) {
      throw new AdminError(400, "id 不合法");
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const beforeRow = await tx.systemConfig.findUnique({
        where: { key: sensitiveWordsConfigKey },
        select: { value: true },
      });

      const before = parseSensitiveWordsConfigValue(beforeRow?.value ?? "");
      const next = before.filter((w) => w !== id && w.toLowerCase() !== id.toLowerCase());
      if (next.length === before.length) {
        throw new AdminError(404, "敏感词不存在");
      }

      const nextValue = JSON.stringify(next);

      await tx.systemConfig.upsert({
        where: { key: sensitiveWordsConfigKey },
        create: { key: sensitiveWordsConfigKey, value: nextValue },
        update: { value: nextValue },
        select: { key: true },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "SENSITIVE_WORD_DELETE",
          target_type: "SYSTEM_CONFIG",
          target_id: null,
          detail_json: toAdminLogDetail({
            key: sensitiveWordsConfigKey,
            removed: id,
            before_total: before.length,
            after_total: next.length,
            at: now.toISOString(),
          }),
        },
      });

      return { items: next };
    });

    sensitiveWordService.invalidate();

    return { items: result.items };
  }

  async getConfig(input: { adminId: number }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const defaults = [
      { key: "base_delivery_fee", value: "5" },
      { key: "distance_price_per_km", value: "1" },
      { key: "urgent_fee", value: "3" },
      { key: "cancel_penalty_rate", value: "0.2" },
      { key: "auto_confirm_minutes", value: "10" },
    ];

    const defaultKeys = defaults.map((d) => d.key);

    const existing = await prisma.systemConfig.findMany({
      where: { key: { in: defaultKeys } },
      select: { key: true },
    });

    const existingKeys = new Set(existing.map((r) => r.key));
    const missingDefaults = defaults.filter((d) => !existingKeys.has(d.key));

    if (missingDefaults.length) {
      await prisma.systemConfig.createMany({
        data: missingDefaults.map((d) => ({ key: d.key, value: d.value })),
        skipDuplicates: true,
      });
    }

    const rows = await prisma.systemConfig.findMany({
      orderBy: { key: "asc" },
      select: { key: true, value: true, updated_at: true },
    });

    await prisma.adminLog.create({
      data: {
        admin_id: input.adminId,
        action: "CONFIG_LIST",
        target_type: "SYSTEM_CONFIG",
        target_id: null,
        detail_json: toAdminLogDetail({
          total: rows.length,
          created_defaults: missingDefaults.map((d) => d.key),
          at: new Date().toISOString(),
        }),
      },
    });

    return { items: rows };
  }

  async updateConfig(input: { adminId: number; key: string; value: string }) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }

    const key = typeof input.key === "string" ? input.key.trim() : "";
    if (!key) {
      throw new AdminError(400, "key 不合法");
    }

    if (input.value === undefined || input.value === null || typeof input.value !== "string") {
      throw new AdminError(400, "value 不合法");
    }
    const value = input.value.trim();
    if (!value) {
      throw new AdminError(400, "value 不合法");
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.systemConfig.findUnique({ where: { key } });

      const updated = await tx.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
        select: { key: true, value: true, updated_at: true },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "CONFIG_UPDATE",
          target_type: "SYSTEM_CONFIG",
          target_id: null,
          detail_json: toAdminLogDetail({
            key,
            before_value: before?.value ?? null,
            after_value: updated.value,
            at: new Date().toISOString(),
          }),
        },
      });

      return updated;
    });

    return { config: result };
  }

  async processComplaint(input: ProcessComplaintInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new AdminError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.complaintId) || input.complaintId <= 0) {
      throw new AdminError(400, "complaintId 不合法");
    }

    const action = toComplaintProcessAction(input.action);
    if (!action) {
      throw new AdminError(400, "action 必须为 resolve/reject");
    }

    const admin_note = toOptionalText(input.admin_note);
    const now = new Date();

    let notifyRunnerId: number | null = null;
    let notifyOrderId: number | null = null;
    let notifyComplaintId: number | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      const complaint = await tx.complaint.findUnique({
        where: { id: input.complaintId },
        select: {
          id: true,
          order_id: true,
          creator_id: true,
          reason: true,
          status: true,
          order: {
            select: {
              id: true,
              taker_id: true,
              final_price: true,
              task: { select: { publisher_id: true, fee_total: true, tip: true } },
            },
          },
        },
      });
      if (!complaint) {
        throw new AdminError(404, "投诉工单不存在");
      }
      if (complaint.status === ComplaintStatus.RESOLVED || complaint.status === ComplaintStatus.REJECTED) {
        throw new AdminError(409, "投诉工单已处理");
      }

      const to_status = action === "resolve" ? ComplaintStatus.RESOLVED : ComplaintStatus.REJECTED;

      const next = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: to_status,
          admin_note,
          admin_id: input.adminId,
          processed_at: now,
        },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "COMPLAINT_PROCESS",
          target_type: "COMPLAINT",
          target_id: complaint.id,
          detail_json: toAdminLogDetail({
            action,
            to_status,
            order_id: complaint.order_id,
            creator_id: complaint.creator_id,
            admin_note: admin_note ?? null,
            at: now.toISOString(),
          }),
        },
      });

      if (to_status !== ComplaintStatus.RESOLVED) {
        return next;
      }

      const runnerId = complaint.order.taker_id;
      if (typeof runnerId !== "number") {
        throw new AdminError(409, "订单未指定跑腿员");
      }

      if (complaint.creator_id === runnerId) {
        return next;
      }

      const severe = isSevereComplaint(complaint.reason);
      const creditDelta = severe ? -10 : -5;

      await creditService.changeCreditScore({
        tx,
        userId: runnerId,
        delta: creditDelta,
      });

      const computedOrderAmount = complaint.order.final_price
        ? new Prisma.Decimal(complaint.order.final_price)
        : complaint.order.task.fee_total.plus(complaint.order.task.tip ?? new Prisma.Decimal(0));

      const rate = severe ? new Prisma.Decimal("0.5") : new Prisma.Decimal("0.2");
      const compensationAmount = roundMoney(computedOrderAmount.mul(rate));

      if (compensationAmount.gt(0)) {
        const runnerWallet = await tx.userWallet.upsert({
          where: { user_id: runnerId },
          create: { user_id: runnerId },
          update: {},
        });

        const receiverWallet = await tx.userWallet.upsert({
          where: { user_id: complaint.creator_id },
          create: { user_id: complaint.creator_id },
          update: {},
        });

        const runnerBeforeTotal = runnerWallet.balance.plus(runnerWallet.frozen);
        const runnerAfterTotal = runnerBeforeTotal.minus(compensationAmount);
        const receiverBeforeTotal = receiverWallet.balance.plus(receiverWallet.frozen);
        const receiverAfterTotal = receiverBeforeTotal.plus(compensationAmount);

        const deducted = await tx.userWallet.updateMany({
          where: { id: runnerWallet.id, balance: { gte: compensationAmount } },
          data: { balance: { decrement: compensationAmount } },
        });
        if (deducted.count !== 1) {
          throw new AdminError(409, "跑腿员余额不足，无法赔偿");
        }

        await tx.userWallet.update({
          where: { id: receiverWallet.id },
          data: { balance: { increment: compensationAmount } },
        });

        await tx.walletLog.createMany({
          data: [
            {
              wallet_id: runnerWallet.id,
              type: "COMPLAINT_COMPENSATION_OUT",
              amount: compensationAmount,
              ref_order_id: complaint.order_id,
              before_balance: runnerBeforeTotal,
              after_balance: runnerAfterTotal,
            },
            {
              wallet_id: receiverWallet.id,
              type: "COMPLAINT_COMPENSATION_IN",
              amount: compensationAmount,
              ref_order_id: complaint.order_id,
              before_balance: receiverBeforeTotal,
              after_balance: receiverAfterTotal,
            },
          ],
        });
      }

      notifyRunnerId = runnerId;
      notifyOrderId = complaint.order_id;
      notifyComplaintId = complaint.id;

      return next;
    });

    if (notifyRunnerId && notifyOrderId && notifyComplaintId) {
      notificationService
        .notifyComplaintProcessed({
          runnerId: notifyRunnerId,
          orderId: notifyOrderId,
          complaintId: notifyComplaintId,
          message: "您有一条投诉已处理",
        })
        .catch(() => {});
    }

    return updated;
  }
}
