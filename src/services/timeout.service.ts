import cron, { type ScheduledTask } from "node-cron";
// @ts-ignore
import { OrderStatus, Prisma, PrismaClient, TaskStatus } from "@prisma/client";
import { notificationService } from "./notification.service";
import { websocketService } from "./websocket.service";
import { creditService } from "./credit.service";

const prisma = new PrismaClient();

type TimeoutConfig = {
  pendingTaskMinutes: number;
  acceptedNoPickupMinutes: number;
  pickedNoCompleteMinutes: number;
};

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
    if (this.task) return;

    this.task = cron.schedule("*/5 * * * *", () => {
      this.runOnce().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[timeout.cron] runOnce failed:", message);
      });
    });

    this.task.start();
  }

  stop() {
    this.task?.stop();
    this.task = null;
  }

  private async loadConfig(): Promise<TimeoutConfig> {
    const keys = [
      "timeout_pending_task_minutes",
      "timeout_accepted_no_pickup_minutes",
      "timeout_picked_no_complete_minutes",
    ] as const;

    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });

    const normalizedRows = rows as Array<{ key: string; value: string }>;
    const map = new Map<string, string>(normalizedRows.map((r) => [r.key, r.value]));

    return {
      pendingTaskMinutes: toPositiveIntOrNull(map.get("timeout_pending_task_minutes")) ?? 30,
      acceptedNoPickupMinutes: toPositiveIntOrNull(map.get("timeout_accepted_no_pickup_minutes")) ?? 20,
      pickedNoCompleteMinutes: toPositiveIntOrNull(map.get("timeout_picked_no_complete_minutes")) ?? 40,
    };
  }

  private async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const config = await this.loadConfig();
      await this.processPendingTaskTimeout(config.pendingTaskMinutes);
      await this.processAcceptedNoPickupTimeout(config.acceptedNoPickupMinutes);
      await this.processPickedNoCompleteTimeout(config.pickedNoCompleteMinutes);
    } finally {
      this.running = false;
    }
  }

  private async processPendingTaskTimeout(timeoutMinutes: number) {
    const cutoff = minutesAgo(timeoutMinutes);
    const candidates = await prisma.task.findMany({
      where: { status: TaskStatus.PENDING, created_at: { lte: cutoff } },
      select: { id: true },
      take: 200,
      orderBy: { created_at: "asc" },
    });

    for (const row of candidates) {
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
          if (!task) return;
          if (task.status !== TaskStatus.PENDING) return;
          if (task.created_at.getTime() > cutoff.getTime()) return;

          const amount = task.fee_total.plus(task.tip ?? new Prisma.Decimal(0));

          const wallet = await tx.userWallet.upsert({
            where: { user_id: task.publisher_id },
            create: { user_id: task.publisher_id },
            update: {},
          });

          const beforeTotal = wallet.balance.plus(wallet.frozen);
          const afterTotal = beforeTotal;

          if (amount.gt(0) && wallet.frozen.gt(0) && wallet.frozen.lt(amount)) {
            throw new Error("发布者冻结金额不足，无法全额退款");
          }

          if (wallet.frozen.gte(amount) && amount.gt(0)) {
            const moved = await tx.userWallet.updateMany({
              where: { id: wallet.id, frozen: { gte: amount } },
              data: { frozen: { decrement: amount }, balance: { increment: amount } },
            });
            if (moved.count === 1) {
              await tx.walletLog.create({
                data: {
                  wallet_id: wallet.id,
                  type: "TASK_TIMEOUT_CANCEL_REFUND",
                  amount,
                  ref_order_id: null,
                  before_balance: beforeTotal,
                  after_balance: afterTotal,
                },
              });
            }
          }

          await tx.task.update({
            where: { id: task.id },
            data: { status: TaskStatus.CANCELLED },
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.pendingTask] failed:", { taskId: row.id, message });
        });
    }
  }

  private async processAcceptedNoPickupTimeout(timeoutMinutes: number) {
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
            .catch(() => {});
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.acceptedNoPickup] failed:", { orderId: row.id, message });
        });
    }
  }

  private async processPickedNoCompleteTimeout(timeoutMinutes: number) {
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
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[timeout.pickedNoComplete] failed:", { orderId: row.id, message });
        });
    }
  }
}

export const timeoutService = new TimeoutService();
