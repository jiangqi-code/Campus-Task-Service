import { Prisma, PrismaClient, Role } from "@prisma/client";

export class WithdrawError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

export const WithdrawStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

type ApplyWithdrawInput = {
  userId: number;
  amount: string | number;
};

type ListMyWithdrawsInput = {
  userId: number;
  page?: number;
  pageSize?: number;
};

const toOptionalDecimal = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return new Prisma.Decimal(value);
  if (typeof value === "string" && value.trim()) return new Prisma.Decimal(value.trim());
  throw new WithdrawError(400, "金额格式不正确");
};

const toRequiredDecimal = (value: string | number) => {
  const dec = toOptionalDecimal(value);
  if (!dec) throw new WithdrawError(400, "金额为必填");
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

export class WithdrawService {
  async apply(input: ApplyWithdrawInput) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new WithdrawError(400, "userId 不合法");
    }

    const amount = toRequiredDecimal(input.amount);
    if (!amount.gt(0)) {
      throw new WithdrawError(400, "amount 必须大于 0");
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new WithdrawError(404, "用户不存在");
    }
    if (user.role !== Role.RUNNER) {
      throw new WithdrawError(403, "无权限");
    }

    const now = new Date();
    const withdraw = await prisma.$transaction(async (tx) => {
      const wallet =
        (await tx.userWallet.findUnique({
          where: { user_id: input.userId },
        })) ??
        (await tx.userWallet.create({
          data: { user_id: input.userId },
        }));

      console.log("[withdraw.apply]", {
        userId: input.userId,
        balance: wallet.balance?.toString?.() ?? String(wallet.balance),
        frozen: wallet.frozen?.toString?.() ?? String(wallet.frozen),
        amount: amount?.toString?.() ?? String(amount),
      });

      const beforeTotal = wallet.balance.plus(wallet.frozen);
      const afterTotal = beforeTotal;

      const moved = await tx.userWallet.updateMany({
        where: { user_id: input.userId, balance: { gte: amount } },
        data: { balance: { decrement: amount }, frozen: { increment: amount } },
      });
      if (moved.count !== 1) {
        throw new WithdrawError(409, "余额不足");
      }

      const created = await tx.withdraw.create({
        data: {
          user_id: input.userId,
          amount,
          status: WithdrawStatus.PENDING,
          apply_time: now,
        },
      });

      await tx.walletLog.create({
        data: {
          wallet_id: wallet.id,
          type: "WITHDRAW_APPLY",
          amount,
          ref_order_id: null,
          before_balance: beforeTotal,
          after_balance: afterTotal,
        },
      });

      return created;
    });

    return withdraw;
  }

  async listMyWithdraws(input: ListMyWithdrawsInput) {
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new WithdrawError(400, "userId 不合法");
    }

    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const where: Prisma.WithdrawWhereInput = {
      user_id: input.userId,
    };

    const [total, items] = await Promise.all([
      prisma.withdraw.count({ where }),
      prisma.withdraw.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
      }),
    ]);

    return { page, pageSize, total, items };
  }
}
