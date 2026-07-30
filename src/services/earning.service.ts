import { Prisma, PrismaClient } from "@prisma/client";

export class EarningError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfWeek = (date: Date) => {
  const start = startOfDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
};

export const getSummary = async (userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new EarningError(400, "userId 不合法");
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const monthStart = startOfMonth(now);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const weekStart = startOfWeek(now);
  const [todayAgg, weekAgg, monthAgg, totalAgg, pendingAgg] = await prisma.$transaction([
    prisma.earning.aggregate({
      where: { user_id: userId, status: "SETTLED", settled_at: { gte: weekStart } },
      _sum: { amount: true },
    }),
    prisma.earning.aggregate({
      where: { user_id: userId, status: "SETTLED", settled_at: { gte: todayStart, lt: tomorrowStart } },
      _sum: { amount: true },
    }),
    prisma.earning.aggregate({
      where: { user_id: userId, status: "SETTLED", settled_at: { gte: monthStart, lt: nextMonthStart } },
      _sum: { amount: true },
    }),
    prisma.earning.aggregate({
      where: { user_id: userId, status: "SETTLED" },
      _sum: { amount: true },
    }),
    prisma.earning.aggregate({
      where: { user_id: userId, status: "PENDING" },
      _sum: { amount: true },
    }),
  ]);

  return {
    todayAmount: todayAgg._sum.amount ?? new Prisma.Decimal(0),
    weekAmount: weekAgg._sum.amount ?? new Prisma.Decimal(0),
    monthAmount: monthAgg._sum.amount ?? new Prisma.Decimal(0),
    totalAmount: totalAgg._sum.amount ?? new Prisma.Decimal(0),
    pendingAmount: pendingAgg._sum.amount ?? new Prisma.Decimal(0),
  };
};

export const getDashboard = async (userId: number, page = 1, pageSize = 10, days = 7) => {
  const summary = await getSummary(userId);
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || 10));
  const safeDays = Math.min(30, Math.max(7, Math.trunc(days) || 7));
  const trendStart = startOfDay(new Date());
  trendStart.setDate(trendStart.getDate() - safeDays + 1);
  const where = { user_id: userId, status: "SETTLED" };
  const [total, items, trendRows] = await Promise.all([
    prisma.earning.count({ where }),
    prisma.earning.findMany({
      where,
      orderBy: [{ settled_at: "desc" }, { created_at: "desc" }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
      include: { order: { select: { id: true, task: { select: { pickup_address: true, delivery_address: true } } } } },
    }),
    prisma.earning.findMany({
      where: { ...where, settled_at: { gte: trendStart } },
      select: { amount: true, settled_at: true },
    }),
  ]);
  const trendMap = new Map<string, number>();
  for (let offset = 0; offset < safeDays; offset += 1) {
    const date = new Date(trendStart);
    date.setDate(date.getDate() + offset);
    trendMap.set(date.toISOString().slice(0, 10), 0);
  }
  trendRows.forEach((row) => {
    if (!row.settled_at) return;
    const key = row.settled_at.toISOString().slice(0, 10);
    trendMap.set(key, (trendMap.get(key) ?? 0) + Number(row.amount));
  });
  return {
    summary,
    trend: [...trendMap].map(([date, amount]) => ({ date, amount })),
    items: items.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      amount: item.amount,
      type: item.type,
      status: item.status,
      settledAt: item.settled_at,
      pickupAddress: item.order?.task.pickup_address ?? "",
      deliveryAddress: item.order?.task.delivery_address ?? "",
    })),
    page: safePage,
    pageSize: safePageSize,
    total,
  };
};
