import type { RequestHandler } from "express";
import { PrismaClient, Role } from "@prisma/client";
import {
  OrderError,
  acceptTask as acceptTaskService,
  cancelOrder as cancelOrderService,
  completeOrder,
  deliverOrder,
  getOrderDetail as getOrderDetailService,
  getOrderTrack as getOrderTrackService,
  listOrders as listOrdersService,
  pickupOrder,
  uploadDeliveryPhoto as uploadDeliveryPhotoService,
  uploadPickupPhoto as uploadPickupPhotoService,
  urgeOrder,
} from "../services/order.service";
import { WalletError, settleOrderOnConfirm } from "../services/wallet.service";

const prisma = new PrismaClient();

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
    const photoUrl = readBodyUrl((req as any).body, [
      "pickup_photo_url",
      "pickupPhotoUrl",
      "photo_url",
      "photoUrl",
      "url",
    ]);
    const order = await pickupOrder(orderId, user.id, photoUrl ?? undefined);
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
    const photoUrl = readBodyUrl((req as any).body, [
      "delivery_photo_url",
      "deliveryPhotoUrl",
      "photo_url",
      "photoUrl",
      "url",
    ]);
    const order = await deliverOrder(orderId, user.id, photoUrl ?? undefined);
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
    const photoUrl = readBodyUrl((req as any).body, [
      "delivery_photo_url",
      "deliveryPhotoUrl",
      "photo_url",
      "photoUrl",
      "url",
    ]);
    const order = await completeOrder(orderId, user.id, photoUrl ?? undefined);
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

    const { type, page, pageSize } = req.query as Partial<Record<string, unknown>>;

    const result = await listOrdersService({
      userId: user.id,
      type,
      page,
      pageSize,
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

function readBodyUrl(body: unknown, keys: string[]): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

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
    const url = readBodyUrl((req as any).body, ["delivery_photo_url"]);

    if (!url) {
      res.status(400).json({ error: "缺少 delivery_photo_url" });
      return;
    }

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
    res.status(200).json(track);
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const detail: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.id ?? ""), 10);
    try {
      const order = await getOrderDetailService(orderId, user.id, String(user.role));
      res.status(200).json({ ...order, hasRunner: true });
      return;
    } catch (err) {
      if (!(err instanceof OrderError) || err.status !== 404) {
        throw err;
      }
    }

    const task = await prisma.task.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        publisher_id: true,
        status: true,
        pickup_address: true,
        pickup_lat: true,
        pickup_lng: true,
        delivery_address: true,
        delivery_lat: true,
        delivery_lng: true,
        type: true,
        urgency: true,
        remark: true,
        images_json: true,
        weight: true,
        size: true,
        is_fragile: true,
        need_inspection: true,
        is_urgent: true,
        fee_total: true,
        tip: true,
        scheduled_time: true,
        cancelled_at: true,
        cancel_reason: true,
        created_at: true,
        publisher: { select: { id: true, nickname: true } },
      },
    });

    if (!task) {
      res.status(404).json({ error: "订单不存在" });
      return;
    }

    const role = String(user.role ?? "").trim().toUpperCase();
    const allowed = role === "ADMIN" || task.publisher_id === user.id;
    if (!allowed) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    res.status(200).json({
      id: task.id,
      publisher_id: task.publisher_id,
      accept_time: null,
      status: task.status,
      progress_percent: 0,
      eta_minutes: null,
      delivery_start_time: null,
      final_price: task.fee_total.plus(task.tip ?? 0),
      created_at: task.created_at,
      pickup_lat: task.pickup_lat,
      pickup_lng: task.pickup_lng,
      delivery_lat: task.delivery_lat,
      delivery_lng: task.delivery_lng,
      hasRunner: false,
      task: {
        pickup_address: task.pickup_address,
        delivery_address: task.delivery_address,
        fee_total: task.fee_total,
        tip: task.tip ?? null,
        type: task.type,
        urgency: task.urgency,
        remark: task.remark,
        images_json: task.images_json,
        weight: task.weight,
        size: task.size,
        is_fragile: task.is_fragile,
        need_inspection: task.need_inspection,
        is_urgent: task.is_urgent,
        scheduled_time: task.scheduled_time,
        cancelled_at: task.cancelled_at,
        cancel_reason: task.cancel_reason,
      },
      taker: {
        id: null,
        nickname: null,
        phone: null,
      },
      publisher: {
        id: task.publisher.id,
        nickname: task.publisher.nickname,
      },
      track: {
        pickup_photo_url: null,
        delivery_photo_url: null,
        pickup_time: null,
        delivery_time: null,
        eta_minutes: null,
      },
    });
  } catch (err) {
    if (err instanceof OrderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const applyRefund: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = parseInt(req.params.orderId);
    const { reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { task: true }
    });

    if (!order) {
      res.status(404).json({ error: "订单不存在" });
      return;
    }

    if (order.task.publisher_id !== user.id) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    if (order.status !== 'COMPLETED') {
      res.status(400).json({ error: "只有已完成订单可以申请退款" });
      return;
    }

    const existing = await prisma.refund.findFirst({
      where: { order_id: orderId, status: 'PENDING' }
    });

    if (existing) {
      res.status(409).json({ error: "已有正在处理中的退款申请" });
      return;
    }

    const refund = await prisma.refund.create({
      data: {
        order_id: orderId,
        user_id: user.id,
        runner_id: order.taker_id!,
        amount: order.final_price ? Number(order.final_price) : 0,
        reason: reason,
        status: 'PENDING'
      }
    });

    res.status(201).json({ success: true, refund });
  } catch (err) {
    console.error('applyRefund error:', err);
    next(err);
  }
};
