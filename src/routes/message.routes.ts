import { Router } from "express";
import { MessageController } from "../controllers/message.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// 获取当前用户消息列表（分页）
router.get("/", requireAuth, MessageController.getMessages);

// 标记单条消息为已读
router.put("/:id/read", requireAuth, MessageController.markAsRead);

// 标记所有消息为已读
router.put("/read-all", requireAuth, MessageController.markAllAsRead);

export default router;
