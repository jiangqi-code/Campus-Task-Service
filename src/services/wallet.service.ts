import { OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";

export class WalletError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

export const settleOrderOnConfirm = async (orderId: number, confirmerUserId: number) => {
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new WalletError(400, "orderId 不合法");
  }
  if (!Number.isFinite(confirmerUserId) || confirmerUserId <= 0) {
    throw new WalletError(400, "userId 不合法");
  }

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
      throw new WalletError(404, "订单不存在");
    }
    if (order.task.publisher_id !== confirmerUserId) {
      throw new WalletError(403, "无权限");
    }
    if (order.status !== OrderStatus.COMPLETED) {
      throw new WalletError(409, "订单状态必须为 COMPLETED");
    }

    const takerId = order.taker_id;
    if (!takerId) {
      throw new WalletError(409, "订单未指定跑腿员");
    }

    const computedPrice = order.task.fee_total.plus(order.task.tip ?? new Prisma.Decimal(0));
    const amount = order.final_price ?? computedPrice;
    if (!amount || amount.lte(0)) {
      throw new WalletError(400, "final_price 不合法");
    }

    const existing = await tx.earning.findFirst({
      where: { order_id: orderId, user_id: takerId, type: "ORDER", status: "SETTLED" },
      select: { id: true },
    });
    if (existing) {
      throw new WalletError(409, "订单已结算");
    }

    if (!order.final_price) {
      await tx.order.update({
        where: { id: orderId },
        data: { final_price: amount },
      });
    }

    const publisherWallet = await tx.userWallet.upsert({
      where: { user_id: confirmerUserId },
      create: { user_id: confirmerUserId },
      update: {},
    });

    const takerWallet = await tx.userWallet.upsert({
      where: { user_id: takerId },
      create: { user_id: takerId },
      update: {},
    });

    const publisherBeforeTotal = publisherWallet.balance.plus(publisherWallet.frozen);
    const publisherAfterTotal = publisherBeforeTotal.minus(amount);
    const takerBeforeTotal = takerWallet.balance.plus(takerWallet.frozen);
    const takerAfterTotal = takerBeforeTotal.plus(amount);

    const frozenUpdate = await tx.userWallet.updateMany({
      where: { id: publisherWallet.id, frozen: { gte: amount } },
      data: { frozen: { decrement: amount } },
    });
    if (frozenUpdate.count !== 1) {
      throw new WalletError(409, "发布者冻结金额不足");
    }

    await tx.userWallet.update({
      where: { id: takerWallet.id },
      data: { balance: { increment: amount } },
    });

    await tx.walletLog.createMany({
      data: [
        {
          wallet_id: publisherWallet.id,
          type: "ORDER_PAY",
          amount,
          ref_order_id: orderId,
          before_balance: publisherBeforeTotal,
          after_balance: publisherAfterTotal,
        },
        {
          wallet_id: takerWallet.id,
          type: "ORDER_EARN",
          amount,
          ref_order_id: orderId,
          before_balance: takerBeforeTotal,
          after_balance: takerAfterTotal,
        },
      ],
    });

    const now = new Date();
    const earning = await tx.earning.create({
      data: {
        user_id: takerId,
        order_id: orderId,
        amount: new Prisma.Decimal(amount),
        type: "ORDER",
        status: "SETTLED",
        settled_at: now,
      },
    });

    await tx.task.update({
      where: { id: order.task_id },
      data: { status: TaskStatus.COMPLETED },
    });

    return { orderId, amount, earningId: earning.id };
  });

  return result;
};
