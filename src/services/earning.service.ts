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

  const [todayAgg, monthAgg, totalAgg, pendingAgg] = await prisma.$transaction([
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
    monthAmount: monthAgg._sum.amount ?? new Prisma.Decimal(0),
    totalAmount: totalAgg._sum.amount ?? new Prisma.Decimal(0),
    pendingAmount: pendingAgg._sum.amount ?? new Prisma.Decimal(0),
  };
};
