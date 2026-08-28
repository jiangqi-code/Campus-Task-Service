import cron, { type ScheduledTask } from "node-cron";
// @ts-ignore
import { FoodOrderStatus, OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { notificationService } from "./notification.service";
import { websocketService } from "./websocket.service";
import { creditService } from "./credit.service";

const prisma = new PrismaClient();

type TimeoutConfig = {
  pendingTaskMinutes: number;
  acceptedNoPickupMinutes: number;
  pickedNoCompleteMinutes: number;
};

const timeoutDefaults = [
  { key: "timeout_pending_task_minutes", value: "120" },
  { key: "timeout_accepted_no_pickup_minutes", value: "20" },
  { key: "timeout_picked_no_complete_minutes", value: "40" },
] as const;

const toPositiveIntOrNull = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

const normalizeTrackPoints = (value: unknown) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

export class TimeoutService {
  private task: ScheduledTask | null = null;
  private running = false;

  start() {
    if (this.task) {
      console.log('[timeout] 定时任务已在运行');
      return;
    }

    console.log('[timeout] 正在启动定时任务，每分钟执行一次');

    this.task = cron.schedule("* * * * *", () => {
      console.log('[timeout] 定时任务触发 -', new Date().toISOString());
      this.runOnce().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[timeout.cron] runOnce failed:", message);
      });
    });

    this.task.start();
    console.log('[timeout] 定时任务已启动');

    // 延迟 3 秒后手动触发一次（用于测试）
    setTimeout(() => {
      console.log('[timeout] 手动触发测试');
      this.runOnce().catch(console.error);
    }, 3000);
  }

  stop() {
    this.task?.stop();
    this.task = null;
    console.log('[timeout] 定时任务已停止');
  }

  private async loadConfig(): Promise<TimeoutConfig> {
    const keys = timeoutDefaults.map((item) => item.key) as Array<(typeof timeoutDefaults)[number]["key"]>;

    await prisma.systemConfig.createMany({
      data: timeoutDefaults.map((item) => ({ key: item.key, value: item.value })),
      skipDuplicates: true,
    });

    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });

    const normalizedRows = rows as Array<{ key: string; value: string }>;
    const map = new Map<string, string>(normalizedRows.map((r) => [r.key, r.value]));

    return {
      pendingTaskMinutes: toPositiveIntOrNull(map.get("timeout_pending_task_minutes")) ?? 120,
      acceptedNoPickupMinutes: toPositiveIntOrNull(map.get("timeout_accepted_no_pickup_minutes")) ?? 20,
      pickedNoCompleteMinutes: toPositiveIntOrNull(map.get("timeout_picked_no_complete_minutes")) ?? 40,
    };
  }

  private async runOnce() {
    console.log('[timeout] runOnce 开始执行');
    if (this.running) {
      console.log('[timeout] runOnce 正在运行中，跳过');
      return;
    }
    this.running = true;
    try {
      const config = await this.loadConfig();
      console.log('[timeout] 配置:', config);
      await this.processPendingTaskTimeout(config.pendingTaskMinutes);
      await this.processAcceptedNoPickupTimeout(config.acceptedNoPickupMinutes);
      await this.processPickedNoCompleteTimeout(config.pickedNoCompleteMinutes);
      await this.processFoodPaymentTimeout();
      console.log('[timeout] runOnce 执行完成');
    } finally {
      this.running = false;
    }
  }

  private async processPendingTaskTimeout(timeoutMinutes: number) {
    console.log("[timeout.pendingTask] 开始检查待接单超时任务", {
      timeoutMinutes,
      now: new Date().toISOString(),
    });

    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
      console.warn("[timeout.pendingTask] timeoutMinutes 无效，跳过执行", { timeoutMinutes });
      return;
    }

    const cutoff = minutesAgo(timeoutMinutes);
    const candidates = await prisma.task.findMany({
      where: { status: TaskStatus.PENDING, created_at: { lte: cutoff } },
      select: { id: true, created_at: true, publisher_id: true, status: true },
      take: 200,
      orderBy: { created_at: "asc" },
    });

    console.log("[timeout.pendingTask] 查询完成", {
      timeoutMinutes,
      cutoff: cutoff.toISOString(),
      candidateCount: candidates.length,
      candidateTaskIds: candidates.map((item) => item.id),
    });

    for (const row of candidates) {
      console.log("[timeout.pendingTask] 开始处理任务", {
        taskId: row.id,
        publisherId: row.publisher_id,
        taskStatus: row.status,
        createdAt: row.created_at.toISOString(),
        cutoff: cutoff.toISOString(),
      });

      await prisma
        .$transaction(async (tx: Prisma.TransactionClient) => {
          const task = await tx.task.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              status: true,
              created_at: true,
              publisher_id: true,
              fee_total: true,
              tip: true,
            },
          });
          if (!task) {
            console.log("[timeout.pendingTask] 任务不存在，跳过", { taskId: row.id });
            return;
          }
          if (task.status !== TaskStatus.PENDING) {
            console.log("[timeout.pendingTask] 任务状态已变化，跳过", {
              taskId: task.id,
              currentStatus: task.status,
            });
            return;
          }
          if (task.created_at.getTime() > cutoff.getTime()) {
            console.log("[timeout.pendingTask] 任务未达到超时阈值，跳过", {
              taskId: task.id,
              createdAt: task.created_at.toISOString(),
              cutoff: cutoff.toISOString(),
            });
            return;
          }

          const amount = task.fee_total.plus(task.tip ?? new Prisma.Decimal(0));

          const wallet = await tx.userWallet.upsert({
            where: { user_id: task.publisher_id },
            create: { user_id: task.publisher_id },
            update: {},
          });

          const beforeTotal = wallet.balance.plus(wallet.frozen);
          let refundAmount = new Prisma.Decimal(0);
          let refundSkippedReason: string | null = null;

          if (wallet.frozen.gte(amount) && amount.gt(0)) {
            const moved = await tx.userWallet.updateMany({
              where: { id: wallet.id, frozen: { gte: amount } },
              data: { frozen: { decrement: amount }, balance: { increment: amount } },
            });
            if (moved.count === 1) {
              refundAmount = amount;
            } else {
              refundSkippedReason = "wallet_update_failed";
            }
          } else if (amount.lte(0)) {
            refundSkippedReason = "refund_amount_not_positive";
          } else {
            refundSkippedReason = "insufficient_frozen_balance";
          }

          const afterTotal = beforeTotal;

          await tx.walletLog.create({
            data: {
              wallet_id: wallet.id,
              type: "TASK_TIMEOUT_CANCEL_REFUND",
              amount: refundAmount,
              ref_order_id: null,
              before_balance: beforeTotal,
              after_balance: afterTotal,
            },
          });

          const cancelledOrders = await tx.order.updateMany({
            where: { task_id: task.id, status: { not: OrderStatus.CANCELLED } },
            data: { status: OrderStatus.CANCELLED },
          });

          await tx.task.update({
            where: { id: task.id },
            data: { status: TaskStatus.CANCELLED },
          });

          await tx.message.create({
            data: {
              user_id: task.publisher_id,
              sender_id: 6,
              sender_name: "系统",
              sender_avatar: "",
              type: "system",
              title: "任务超时已自动取消",
              content: `任务 #${task.id} 发布后 ${timeoutMinutes} 分钟内无人接单，系统已自动取消${refundAmount.gt(0) ? "，冻结金额已原路退回钱包余额" : ""}`,
              related_id: task.id,
              conversation_id: `task:${task.id}`,
              is_read: false,
            },
          });

          console.log("[timeout.pendingTask] 任务处理完成", {
            taskId: task.id,
            timeoutMinutes,
            cutoff: cutoff.toISOString(),
            refundAmount: refundAmount.toString(),
            frozenBefore: wallet.frozen.toString(),
            expectedRefundAmount: amount.toString(),
            refundSkippedReason,
            cancelledOrderCount: cancelledOrders.count,
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.pendingTask] failed:", { taskId: row.id, message });
        });
    }
  }

  private async processFoodPaymentTimeout() {
    const now = new Date();
    const candidates = await prisma.foodOrder.findMany({
      where: { status: FoodOrderStatus.PENDING_PAYMENT, payment_expire_at: { lte: now } },
      select: { id: true, user_id: true },
      take: 200,
      orderBy: { payment_expire_at: "asc" },
    });

    for (const row of candidates) {
      const cancelled = await prisma.$transaction(async (tx) => {
        const changed = await tx.foodOrder.updateMany({
          where: { id: row.id, status: FoodOrderStatus.PENDING_PAYMENT, payment_expire_at: { lte: now } },
          data: { status: FoodOrderStatus.CANCELLED, cancelled_at: now, cancel_reason: "支付超时自动关闭" },
        });
        if (!changed.count) return false;
        await tx.foodOrderTimeline.create({ data: { food_order_id: row.id, from_status: FoodOrderStatus.PENDING_PAYMENT, to_status: FoodOrderStatus.CANCELLED, actor_role: "SYSTEM", note: "订单超时未支付，系统自动关闭" } });
        await tx.message.create({ data: { user_id: row.user_id, sender_name: "系统", type: "system", title: "外卖订单已自动关闭", content: `订单 #${row.id} 超时未支付，已自动关闭。`, related_id: row.id, conversation_id: `food:${row.id}`, is_read: false } });
        return true;
      });
      if (cancelled) void notificationService.notifyFoodOrderStatusChanged({ orderId: row.id, fromStatus: FoodOrderStatus.PENDING_PAYMENT, toStatus: FoodOrderStatus.CANCELLED });
    }
  }

  private async processAcceptedNoPickupTimeout(timeoutMinutes: number) {
    console.log('[timeout] 检查已接单未取件超时...');
    const cutoff = minutesAgo(timeoutMinutes);

    const candidates = await prisma.order.findMany({
      where: {
        status: OrderStatus.ACCEPTED,
        OR: [{ accept_time: { lte: cutoff } }, { accept_time: null, created_at: { lte: cutoff } }],
      },
      select: { id: true },
      take: 200,
      orderBy: [{ accept_time: "asc" }, { created_at: "asc" }],
    });

    console.log('[timeout] 找到已接单未取件超时订单:', candidates.length);

    for (const row of candidates) {
      await prisma
        .$transaction(async (tx: Prisma.TransactionClient) => {
          const order = await tx.order.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              status: true,
              taker_id: true,
              final_price: true,
              created_at: true,
              accept_time: true,
              task_id: true,
              task: { select: { publisher_id: true, fee_total: true, tip: true } },
            },
          });
          if (!order) return;
          if (order.status !== OrderStatus.ACCEPTED) return;
          const baseTime = order.accept_time ?? order.created_at;
          if (baseTime.getTime() > cutoff.getTime()) return;

          const computed = order.task.fee_total.plus(order.task.tip ?? new Prisma.Decimal(0));
          const amount = order.final_price ?? computed;
          if (!amount || !amount.gt(0)) return;

          const publisherWallet = await tx.userWallet.upsert({
            where: { user_id: order.task.publisher_id },
            create: { user_id: order.task.publisher_id },
            update: {},
          });

          const publisherBeforeTotal = publisherWallet.balance.plus(publisherWallet.frozen);
          const publisherAfterTotal = publisherBeforeTotal;

          if (publisherWallet.frozen.gt(0) && publisherWallet.frozen.lt(amount)) {
            throw new Error("发布者冻结金额不足，无法全额退款");
          }

          if (publisherWallet.frozen.gte(amount) && amount.gt(0)) {
            const refund = await tx.userWallet.updateMany({
              where: { id: publisherWallet.id, frozen: { gte: amount } },
              data: { frozen: { decrement: amount }, balance: { increment: amount } },
            });
            if (refund.count === 1) {
              await tx.walletLog.create({
                data: {
                  wallet_id: publisherWallet.id,
                  type: "ORDER_TIMEOUT_NO_PICKUP_REFUND",
                  amount,
                  ref_order_id: order.id,
                  before_balance: publisherBeforeTotal,
                  after_balance: publisherAfterTotal,
                },
              });
            }
          }

          await tx.task.update({
            where: { id: order.task_id },
            data: { status: TaskStatus.PENDING },
          });

          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.CANCELLED },
          });

          if (order.taker_id) {
            await creditService.changeCreditScore({ tx, userId: order.taker_id, delta: -8 });
          }

          notificationService
            .notifyOrderStatusChanged({
              orderId: order.id,
              fromStatus: OrderStatus.ACCEPTED,
              toStatus: OrderStatus.CANCELLED,
            })
            .catch(() => { });

          console.log('[timeout] 已接单未取件订单已取消:', order.id);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.acceptedNoPickup] failed:", { orderId: row.id, message });
        });
    }
  }

  private async processPickedNoCompleteTimeout(timeoutMinutes: number) {
    console.log('[timeout] 检查配送中超时...');
    const cutoff = minutesAgo(timeoutMinutes);
    const cooldownMinutes = 30;
    const cooldownCutoff = minutesAgo(cooldownMinutes);

    const candidates = await prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PICKED, OrderStatus.DELIVERING] },
        pickup_time: { lte: cutoff },
      },
      select: { id: true },
      take: 200,
      orderBy: { pickup_time: "asc" },
    });

    console.log('[timeout] 找到配送中超时订单:', candidates.length);

    for (const row of candidates) {
      await prisma
        .$transaction(async (tx: Prisma.TransactionClient) => {
          const order = await tx.order.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              status: true,
              taker_id: true,
              pickup_time: true,
              task: { select: { publisher_id: true } },
            },
          });
          if (!order) return;
          if (order.status !== OrderStatus.PICKED && order.status !== OrderStatus.DELIVERING) return;
          if (!order.pickup_time || order.pickup_time.getTime() > cutoff.getTime()) return;
          if (!order.taker_id) return;

          const track = await tx.orderTrack.findUnique({
            where: { order_id: order.id },
            select: { id: true, location_points_json: true },
          });

          const points = normalizeTrackPoints(track?.location_points_json);
          for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i] as { type?: unknown; at?: unknown };
            if (p?.type !== "TIMEOUT_DELIVERING_REMIND") continue;
            const at = typeof p.at === "string" ? new Date(p.at) : null;
            if (at && Number.isFinite(at.getTime()) && at.getTime() >= cooldownCutoff.getTime()) {
              return;
            }
            break;
          }

          const nowIso = new Date().toISOString();
          points.push({
            type: "TIMEOUT_DELIVERING_REMIND",
            order_id: order.id,
            publisher_id: order.task.publisher_id,
            taker_id: order.taker_id,
            at: nowIso,
          });

          if (track) {
            await tx.orderTrack.update({
              where: { id: track.id },
              data: { location_points_json: points as Prisma.InputJsonValue },
            });
          } else {
            await tx.orderTrack.create({
              data: { order_id: order.id, location_points_json: points as Prisma.InputJsonValue },
            });
          }

          const payload = {
            orderId: order.id,
            type: "TIMEOUT_DELIVERING_REMIND",
            publisherId: order.task.publisher_id,
            takerId: order.taker_id,
            at: nowIso,
          };

          const io = websocketService.getIO();
          io.to(`order:${order.id}`).emit("order:remind", payload);
          io.to(`user:${order.task.publisher_id}`).emit("order:remind", payload);
          io.to(`user:${order.taker_id}`).emit("order:remind", payload);

          console.log('[timeout] 配送超时提醒已发送:', order.id);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.pickedNoComplete] failed:", { orderId: row.id, message });
        });
    }
  }
}

export const timeoutService = new TimeoutService();
