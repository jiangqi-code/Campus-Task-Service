import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type CreditLevel = "青铜" | "白银" | "黄金" | "钻石";

export const getCreditLevel = (score: number): CreditLevel => {
  const s = Number.isFinite(score) ? Math.trunc(score) : 0;
  if (s >= 801) return "钻石";
  if (s >= 601) return "黄金";
  if (s >= 301) return "白银";
  return "青铜";
};

export const getCreditDeltaByReviewRating = (rating: number) => {
  if (rating === 5) return 3;
  if (rating === 1 || rating === 2) return -5;
  return 0;
};

export const isOnTimeDelivery = (params: {
  acceptTime: Date | null;
  createdAt: Date;
  completeTime: Date;
  etaMinutes: number | null;
}) => {
  const base = params.acceptTime ?? params.createdAt;
  const eta = typeof params.etaMinutes === "number" && Number.isFinite(params.etaMinutes) ? params.etaMinutes : 0;
  const deadlineAt = base.getTime() + Math.trunc(eta) * 60_000;
  return params.completeTime.getTime() <= deadlineAt;
};

export class CreditService {
  getLevel(score: number) {
    return getCreditLevel(score);
  }

  async setCreditScore(input: {
    userId: number;
    creditScore: number;
    tx?: Prisma.TransactionClient;
  }) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) return null;
    const score = Number.isFinite(input.creditScore) ? Math.trunc(input.creditScore) : 0;

    const db = input.tx ?? prisma;
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, credit_score: true },
    });
    if (!user || user.status === -1) return null;

    const nextStatus = score < 0 ? 0 : user.status;
    const updated = await db.user.update({
      where: { id: input.userId },
      data: {
        credit_score: score,
        ...(nextStatus !== user.status ? { status: nextStatus } : undefined),
      },
      select: { id: true, status: true, credit_score: true },
    });

    return { ...updated, credit_level: getCreditLevel(updated.credit_score) };
  }

  async changeCreditScore(input: {
    userId: number;
    delta: number;
    tx?: Prisma.TransactionClient;
  }) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) return null;
    const delta = Number.isFinite(input.delta) ? Math.trunc(input.delta) : 0;
    if (delta === 0) return null;

    const db = input.tx ?? prisma;
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, credit_score: true },
    });
    if (!user || user.status === -1) return null;

    const nextScore = (user.credit_score ?? 0) + delta;
    const nextStatus = nextScore < 0 ? 0 : user.status;

    const updated = await db.user.update({
      where: { id: input.userId },
      data: {
        credit_score: nextScore,
        ...(nextStatus !== user.status ? { status: nextStatus } : undefined),
      },
      select: { id: true, status: true, credit_score: true },
    });

    return {
      ...updated,
      before_credit_score: user.credit_score ?? 0,
      credit_level: getCreditLevel(updated.credit_score),
    };
  }
}

export const creditService = new CreditService();
