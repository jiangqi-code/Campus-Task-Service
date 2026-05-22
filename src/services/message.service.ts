// @ts-ignore
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class MessageService {
  /**
   * 创建消息
   */
  static async create(
    userId: number,
    type: string,
    title: string,
    content: string,
    relatedId?: number | null,
    // 新增可选参数
    senderId?: number | null,
    senderName?: string | null,
    senderAvatar?: string | null,
    conversationId?: string | null
  ) {
    return prisma.message.create({
      data: {
        user_id: userId,
        type,
        title,
        content,
        related_id: relatedId ?? null,
        sender_id: senderId ?? null,
        sender_name: senderName ?? null,
        sender_avatar: senderAvatar ?? null,
        conversation_id: conversationId ?? null,
      },
    });
  }

  /**
   * 获取用户消息列表（分页）- 修改这里
   */
  static async getUserMessages(userId: number, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total, unreadCount] = await Promise.all([
      prisma.message.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        // ✅ 添加 select 明确返回需要的字段
        select: {
          id: true,
          user_id: true,
          sender_id: true,
          sender_name: true,
          sender_avatar: true,
          conversation_id: true,
          type: true,
          title: true,
          content: true,
          related_id: true,
          is_read: true,
          created_at: true,
        },
      }),
      prisma.message.count({
        where: { user_id: userId },
      }),
      prisma.message.count({
        where: { user_id: userId, is_read: false },
      }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      pageSize,
    };
  }

  /**
   * 标记单条消息为已读
   */
  static async markAsRead(userId: number, messageId: number) {
    const message = await prisma.message.findFirst({
      where: { id: messageId, user_id: userId },
    });

    if (!message) {
      throw new Error("消息不存在或无权限");
    }

    return prisma.message.update({
      where: { id: messageId },
      data: { is_read: true },
    });
  }

  /**
   * 标记用户所有消息为已读
   */
  static async markAllAsRead(userId: number) {
    await prisma.message.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true },
    });

    return { success: true };
  }
}