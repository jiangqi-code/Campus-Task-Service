import { OrderStatus, Prisma, PrismaClient, RefundStatus } from "@prisma/client";

export class RefundError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const refundWindowMs = 24 * 60 * 60 * 1000;

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
};

type ApplyRefundInput = {
  orderId: number;
  userId: number;
  reason: unknown;
};

type ListRefundsInput = {
  page?: unknown;
  pageSize?: unknown;
  status?: unknown;
};

type AuditRefundInput = {
  adminId: number;
  refundId: number;
  action: unknown;
};

type AuditAction = "approve" | "reject";

const toAuditAction = (value: unknown): AuditAction | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "approve" || v === "reject") return v;
  return null;
};

export class RefundService {
  async applyRefund(input: ApplyRefundInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) {
      throw new RefundError(400, "orderId 不合法");
    }
    if (!Number.isFinite(input.userId) || input.userId <= 0) {
      throw new RefundError(400, "userId 不合法");
    }

    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) {
      throw new RefundError(400, "reason 为必填");
    }

    const now = new Date();
    try {
      const refund = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: {
            id: true,
            status: true,
            taker_id: true,
            complete_time: true,
            final_price: true,
            task: { select: { publisher_id: true, fee_total: true, tip: true } },
          },
        });

        if (!order) {
          throw new RefundError(404, "订单不存在");
        }
        if (order.task.publisher_id !== input.userId) {
          throw new RefundError(403, "无权限");
        }
        if (order.status !== OrderStatus.COMPLETED) {
          throw new RefundError(409, "订单状态必须为 COMPLETED");
        }

        const completeTime = order.complete_time;
        if (!completeTime) {
          throw new RefundError(409, "订单未完成，无法申请售后");
        }
        if (now.getTime() - completeTime.getTime() > refundWindowMs) {
          throw new RefundError(409, "已超过 24 小时，无法申请售后");
        }

        const runnerId = order.taker_id;
        if (!runnerId) {
          throw new RefundError(409, "订单未指定跑腿员");
        }

        const amount =
          order.final_price ??
          order.task.fee_total.plus(order.task.tip ?? new Prisma.Decimal(0));

        if (!amount || amount.lte(0)) {
          throw new RefundError(409, "退款金额不合法");
        }

        const earning = await tx.earning.findFirst({
          where: { order_id: input.orderId, user_id: runnerId, type: "ORDER", status: "SETTLED" },
          select: { id: true },
        });
        if (!earning) {
          throw new RefundError(409, "订单未结算，无法申请售后");
        }

        const existing = await tx.refund.findUnique({
          where: { order_id: input.orderId },
          select: { id: true },
        });
        if (existing) {
          throw new RefundError(409, "该订单已申请售后");
        }

        return tx.refund.create({
          data: {
            order_id: input.orderId,
            user_id: input.userId,
            runner_id: runnerId,
            amount,
            reason,
            status: RefundStatus.PENDING,
            apply_time: now,
          },
        });
      });

      return refund;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          throw new RefundError(409, "该订单已申请售后");
        }
      }
      throw err;
    }
  }

  async listRefunds(input: ListRefundsInput) {
    const page = Math.max(1, parseIntOr(input.page, 1));
    const pageSize = Math.min(100, Math.max(1, parseIntOr(input.pageSize, 10)));
    const skip = (page - 1) * pageSize;

    const status = typeof input.status === "string" && input.status.trim() ? input.status.trim() : undefined;

    const where: Prisma.RefundWhereInput = {
      ...(status ? { status: status as RefundStatus } : undefined),
    };

    const [total, items] = await Promise.all([
      prisma.refund.count({ where }),
      prisma.refund.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          order: {
            select: {
              id: true,
              status: true,
              complete_time: true,
              final_price: true,
              task: { select: { id: true, publisher_id: true, fee_total: true, tip: true } },
            },
          },
          user: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          runner: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
          audit_admin: { select: { id: true, student_id: true, phone: true, nickname: true, role: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  async auditRefund(input: AuditRefundInput) {
    if (!Number.isFinite(input.adminId) || input.adminId <= 0) {
      throw new RefundError(400, "adminId 不合法");
    }
    if (!Number.isFinite(input.refundId) || input.refundId <= 0) {
      throw new RefundError(400, "refundId 不合法");
    }

    const action = toAuditAction(input.action);
    if (!action) {
      throw new RefundError(400, "action 必须为 approve/reject");
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: input.refundId },
        select: { id: true, order_id: true, user_id: true, runner_id: true, amount: true, status: true },
      });
      if (!refund) {
        throw new RefundError(404, "售后申请不存在");
      }
      if (refund.status !== RefundStatus.PENDING) {
        throw new RefundError(409, "售后申请状态不是 PENDING");
      }

      if (action === "reject") {
        const next = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.REJECTED,
            audit_time: now,
            audit_admin_id: input.adminId,
          },
        });

        await tx.adminLog.create({
          data: {
            admin_id: input.adminId,
            action: "REFUND_AUDIT",
            target_type: "REFUND",
            target_id: refund.id,
            detail_json: toAdminLogDetail({
              action,
              to_status: RefundStatus.REJECTED,
              order_id: refund.order_id,
              user_id: refund.user_id,
              runner_id: refund.runner_id,
              amount: String(refund.amount),
              at: now.toISOString(),
            }),
          },
        });

        return next;
      }

      const runnerWallet = await tx.userWallet.upsert({
        where: { user_id: refund.runner_id },
        create: { user_id: refund.runner_id },
        update: {},
      });

      const userWallet = await tx.userWallet.upsert({
        where: { user_id: refund.user_id },
        create: { user_id: refund.user_id },
        update: {},
      });

      const runnerBeforeTotal = runnerWallet.balance.plus(runnerWallet.frozen);
      const runnerAfterTotal = runnerBeforeTotal.minus(refund.amount);
      const userBeforeTotal = userWallet.balance.plus(userWallet.frozen);
      const userAfterTotal = userBeforeTotal.plus(refund.amount);

      const deducted = await tx.userWallet.updateMany({
        where: { id: runnerWallet.id, balance: { gte: refund.amount } },
        data: { balance: { decrement: refund.amount } },
      });
      if (deducted.count !== 1) {
        throw new RefundError(409, "跑腿员余额不足");
      }

      await tx.userWallet.update({
        where: { id: userWallet.id },
        data: { balance: { increment: refund.amount } },
      });

      await tx.walletLog.createMany({
        data: [
          {
            wallet_id: runnerWallet.id,
            type: "REFUND_OUT",
            amount: refund.amount,
            ref_order_id: refund.order_id,
            before_balance: runnerBeforeTotal,
            after_balance: runnerAfterTotal,
          },
          {
            wallet_id: userWallet.id,
            type: "REFUND_IN",
            amount: refund.amount,
            ref_order_id: refund.order_id,
            before_balance: userBeforeTotal,
            after_balance: userAfterTotal,
          },
        ],
      });

      const next = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.APPROVED,
          audit_time: now,
          audit_admin_id: input.adminId,
        },
      });

      await tx.adminLog.create({
        data: {
          admin_id: input.adminId,
          action: "REFUND_AUDIT",
          target_type: "REFUND",
          target_id: refund.id,
          detail_json: toAdminLogDetail({
            action,
            to_status: RefundStatus.APPROVED,
            order_id: refund.order_id,
            user_id: refund.user_id,
            runner_id: refund.runner_id,
            amount: String(refund.amount),
            at: now.toISOString(),
          }),
        },
      });

      return next;
    });

    return updated;
  }
}

export const refundService = new RefundService();
