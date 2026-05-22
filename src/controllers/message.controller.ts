import type { Request, Response, NextFunction } from "express";
import { MessageService } from "../services/message.service";

export class MessageController {
  /**
   * 获取当前用户消息列表
   */
  static async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "未登录" });
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

      const result = await MessageService.getUserMessages(userId, page, pageSize);
      return res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * 标记单条消息为已读
   */
  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "未登录" });
      }

      const messageId = parseInt(req.params.id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return res.status(400).json({ error: "消息ID不合法" });
      }

      await MessageService.markAsRead(userId, messageId);
      return res.json({ success: true });
    } catch (error: any) {
      if (error?.message === "消息不存在或无权限") {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  }

  /**
   * 标记所有消息为已读
   */
  static async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "未登录" });
      }

      await MessageService.markAllAsRead(userId);
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
