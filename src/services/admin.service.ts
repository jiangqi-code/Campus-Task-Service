import { OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { WithdrawStatus } from "./withdraw.service";
import { notificationService } from "./notification.service";

export class AdminError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

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

const parseIntOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
};

const isOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (Object.values(OrderStatus) as string[]).includes(value);
};

const toAdminLogDetail = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value as Prisma.InputJsonValue;
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
}
