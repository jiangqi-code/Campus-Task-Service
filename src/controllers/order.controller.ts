import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import {
  OrderError,
  acceptTask as acceptTaskService,
  cancelOrder as cancelOrderService,
  completeOrder,
  deliverOrder,
  pickupOrder,
  urgeOrder,
} from "../services/order.service";
import { WalletError, settleOrderOnConfirm } from "../services/wallet.service";

export const acceptTask: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const taskId = Number.parseInt(String(req.params.taskId ?? ""), 10);
    const order = await acceptTaskService(taskId, user.id);
    res.status(201).json({ order });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const pickup: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const order = await pickupOrder(orderId, user.id);
    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const deliver: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const order = await deliverOrder(orderId, user.id);
    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const complete: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const order = await completeOrder(orderId, user.id);
    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const confirmOrder: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role !== Role.USER) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const result = await settleOrderOnConfirm(orderId, user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof WalletError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const cancelOrder: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const result = await cancelOrderService(orderId, user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const urge: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const result = await urgeOrder(orderId, user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
