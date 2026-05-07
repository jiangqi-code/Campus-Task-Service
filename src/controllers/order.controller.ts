import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import {
  OrderError,
  acceptTask as acceptTaskService,
  cancelOrder as cancelOrderService,
  completeOrder,
  deliverOrder,
  getOrderList as getOrderListService,
  getOrderTrack as getOrderTrackService,
  pickupOrder,
  uploadDeliveryPhoto as uploadDeliveryPhotoService,
  uploadPickupPhoto as uploadPickupPhotoService,
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

export const getOrderList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { status, page, pageSize, sortBy, sortOrder } = req.query as Partial<Record<string, unknown>>;

    const result = await getOrderListService({
      userId: user.id,
      role: String(user.role),
      status,
      page,
      pageSize,
      sortBy,
      sortOrder,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

const getUploadedFilename = (req: unknown, fieldName: string): string | null => {
  const filesObj = (req as { files?: unknown }).files;
  if (!filesObj || typeof filesObj !== "object") return null;
  const group = (filesObj as Record<string, unknown>)[fieldName];
  if (!Array.isArray(group) || group.length === 0) return null;
  const first = group[0] as { filename?: unknown } | undefined;
  if (!first || typeof first.filename !== "string" || !first.filename.trim()) return null;
  return first.filename.trim();
};

export const uploadPickupPhoto: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const filename = getUploadedFilename(req, "photo");
    if (!filename) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const url = `/uploads/${filename}`;
    const track = await uploadPickupPhotoService(orderId, user.id, url);
    res.status(200).json({ track });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const uploadDeliveryPhoto: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const filename = getUploadedFilename(req, "photo");
    if (!filename) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const url = `/uploads/${filename}`;
    const track = await uploadDeliveryPhotoService(orderId, user.id, url);
    res.status(200).json({ track });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getTrack: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const track = await getOrderTrackService(orderId, user.id, String(user.role));
    res.status(200).json({ track });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
