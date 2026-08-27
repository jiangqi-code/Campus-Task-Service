import { type FoodOrderStatus, type OrderStatus, PrismaClient } from "@prisma/client";
import { websocketService } from "./websocket.service";

const prisma = new PrismaClient();

type NotifyOrderStatusChangedInput = {
  orderId: number;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
};

type NotifyOrderUrgedInput = {
  orderId: number;
  publisherId?: number;
  takerId?: number;
  at?: string;
};

type NotifyFoodOrderStatusChangedInput = {
  orderId: number;
  fromStatus?: FoodOrderStatus;
  toStatus: FoodOrderStatus;
};

type NotifyComplaintProcessedInput = {
  runnerId: number;
  complaintId: number;
  orderId: number;
  message?: string;
  at?: string;
};

export class NotificationService {
  async notifyFoodOrderStatusChanged(input: NotifyFoodOrderStatusChangedInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) return;
    if (input.fromStatus && input.fromStatus === input.toStatus) return;

    const order = await prisma.foodOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, user_id: true, runner_id: true, merchant: { select: { owner_id: true, name: true } } },
    });
    if (!order) return;

    const recipientIds = Array.from(new Set([order.user_id, order.runner_id, order.merchant.owner_id].filter((id): id is number => typeof id === "number")));
    const payload = {
      business: "FOOD",
      orderId: order.id,
      merchantName: order.merchant.name,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      userId: order.user_id,
      runnerId: order.runner_id,
      at: new Date().toISOString(),
    };

    try {
      const io = websocketService.getIO();
      for (const userId of recipientIds) io.to(`user:${userId}`).emit("food:order:status", payload);
      for (const userId of recipientIds) websocketService.sendToUser(userId, { type: "FOOD_ORDER_STATUS", data: payload });
    } catch (error) {
      // Real-time channel must not roll back a completed business transaction.
      console.error("[NotificationService] 外卖订单状态推送失败:", error);
    }
  }

  async notifyOrderStatusChanged(input: NotifyOrderStatusChangedInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) return;
    if (input.fromStatus && input.fromStatus === input.toStatus) return;

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        taker_id: true,
        task: { select: { publisher_id: true } },
      },
    });
    if (!order) return;

    const publisherId = order.task.publisher_id;
    const takerId = order.taker_id;

    const payload = {
      orderId: order.id,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      publisherId,
      takerId,
      at: new Date().toISOString(),
    };

    const io = websocketService.getIO();

    // Socket.IO 推送
    io.to(`order:${order.id}`).emit("order:status", payload);
    io.to(`user:${publisherId}`).emit("order:status", payload);
    if (typeof takerId === "number") {
      io.to(`user:${takerId}`).emit("order:status", payload);
    }

    // ✅ 原生 WebSocket 推送（兼容前端）
    try {
      websocketService.sendToUser(publisherId, {
        type: "ORDER_STATUS",
        data: payload,
      });
      if (typeof takerId === "number") {
        websocketService.sendToUser(takerId, {
          type: "ORDER_STATUS",
          data: payload,
        });
      }
    } catch (err) {
      console.error("[NotificationService] WebSocket 推送失败:", err);
    }
  }

  async notifyOrderUrged(input: NotifyOrderUrgedInput) {
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) return;

    const publisherId =
      typeof input.publisherId === "number" && Number.isFinite(input.publisherId) && input.publisherId > 0
        ? Math.trunc(input.publisherId)
        : null;
    const takerId =
      typeof input.takerId === "number" && Number.isFinite(input.takerId) && input.takerId > 0
        ? Math.trunc(input.takerId)
        : null;

    const order =
      publisherId && takerId
        ? null
        : await prisma.order.findUnique({
          where: { id: input.orderId },
          select: {
            id: true,
            taker_id: true,
            task: { select: { publisher_id: true } },
          },
        });

    const finalPublisherId = publisherId ?? order?.task.publisher_id ?? null;
    const finalTakerId = takerId ?? (typeof order?.taker_id === "number" ? order.taker_id : null);
    if (!finalPublisherId || !finalTakerId) return;

    const payload = {
      orderId: input.orderId,
      publisherId: finalPublisherId,
      takerId: finalTakerId,
      at: typeof input.at === "string" && input.at.trim() ? input.at.trim() : new Date().toISOString(),
    };

    const io = websocketService.getIO();
    io.to(`user:${finalTakerId}`).emit("order:urge", payload);

    // ✅ 原生 WebSocket 推送催单消息（关键！前端需要收到 URGE 类型）
    try {
      websocketService.sendToUser(finalTakerId, {
        type: "URGE",
        data: {
          orderId: input.orderId,
          message: `用户催单，请尽快处理订单 #${input.orderId}`,
        },
      });
    } catch (err) {
      console.error("[NotificationService] 催单 WebSocket 推送失败:", err);
    }
  }

  async notifyComplaintProcessed(input: NotifyComplaintProcessedInput) {
    if (!Number.isFinite(input.runnerId) || input.runnerId <= 0) return;
    if (!Number.isFinite(input.complaintId) || input.complaintId <= 0) return;
    if (!Number.isFinite(input.orderId) || input.orderId <= 0) return;

    const payload = {
      runnerId: Math.trunc(input.runnerId),
      complaintId: Math.trunc(input.complaintId),
      orderId: Math.trunc(input.orderId),
      message: typeof input.message === "string" && input.message.trim() ? input.message.trim() : "您有一条投诉已处理",
      at: typeof input.at === "string" && input.at.trim() ? input.at.trim() : new Date().toISOString(),
    };

    const io = websocketService.getIO();
    io.to(`user:${payload.runnerId}`).emit("complaint:processed", payload);

    // ✅ 原生 WebSocket 推送
    try {
      websocketService.sendToUser(payload.runnerId, {
        type: "COMPLAINT_PROCESSED",
        data: payload,
      });
    } catch (err) {
      console.error("[NotificationService] 投诉推送失败:", err);
    }
  }
}

export const notificationService = new NotificationService();
