import { type OrderStatus, PrismaClient } from "@prisma/client";
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

type NotifyComplaintProcessedInput = {
  runnerId: number;
  complaintId: number;
  orderId: number;
  message?: string;
  at?: string;
};

export class NotificationService {
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

    io.to(`order:${order.id}`).emit("order:status", payload);
    io.to(`user:${publisherId}`).emit("order:status", payload);
    if (typeof takerId === "number") {
      io.to(`user:${takerId}`).emit("order:status", payload);
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
  }
}

export const notificationService = new NotificationService();
