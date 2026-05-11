import type { RequestHandler } from "express";
import { ChatError, ChatService } from "../services/chat.service";

const chatService = new ChatService();

export const send: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const chatMessage = await chatService.sendMessage({
      orderId: body.orderId,
      fromUserId: user.id,
      toUserId: body.toUserId,
      message: body.message,
    });

    res.status(201).json({ chatMessage });
  } catch (err) {
    if (err instanceof ChatError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const messages: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = (req.query ?? {}).orderId;
    const msgs = await chatService.getMessages({ orderId, userId: user.id });
    res.status(200).json({ messages: msgs });
  } catch (err) {
    if (err instanceof ChatError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

