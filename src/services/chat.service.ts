import { PrismaClient } from "@prisma/client";

export class ChatError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

const parsePositiveInt = (value: unknown): number | null => {
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

export class ChatService {
  async sendMessage(input: {
    orderId: unknown;
    fromUserId: number;
    toUserId: unknown;
    message: unknown;
  }) {
    const orderId = parsePositiveInt(input.orderId);
    const toUserId = parsePositiveInt(input.toUserId);
    const message =
      typeof input.message === "string" ? input.message.trim() : String(input.message ?? "").trim();

    if (!orderId) throw new ChatError(400, "orderId 不合法");
    if (!toUserId) throw new ChatError(400, "toUserId 不合法");
    if (!message) throw new ChatError(400, "message 不能为空");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        taker_id: true,
        task: { select: { publisher_id: true } },
      },
    });
    if (!order) throw new ChatError(404, "订单不存在");

    const publisherId = order.task.publisher_id;
    const takerId = order.taker_id;
    const fromUserId = input.fromUserId;

    const isPublisher = fromUserId === publisherId;
    const isTaker = takerId !== null && fromUserId === takerId;
    if (!isPublisher && !isTaker) throw new ChatError(403, "无权限");

    const otherUserId = isPublisher ? takerId : publisherId;
    if (!otherUserId) throw new ChatError(409, "订单尚未接单，无法聊天");
    if (toUserId !== otherUserId) throw new ChatError(400, "toUserId 必须是订单另一方用户");

    const chatMessage = await prisma.chatMessage.create({
      data: {
        order_id: orderId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        message,
      },
    });

    return chatMessage;
  }

  async getMessages(input: { orderId: unknown; userId: number }) {
    const orderId = parsePositiveInt(input.orderId);
    if (!orderId) throw new ChatError(400, "orderId 不合法");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        taker_id: true,
        task: { select: { publisher_id: true } },
      },
    });
    if (!order) throw new ChatError(404, "订单不存在");

    const publisherId = order.task.publisher_id;
    const takerId = order.taker_id;
    const userId = input.userId;

    const isPublisher = userId === publisherId;
    const isTaker = takerId !== null && userId === takerId;
    if (!isPublisher && !isTaker) throw new ChatError(403, "无权限");

    const messages = await prisma.chatMessage.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: "asc" },
    });

    return messages;
  }
}

