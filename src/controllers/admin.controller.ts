import type { RequestHandler } from "express";
import { OrderStatus } from "@prisma/client";
import { AdminError, AdminService } from "../services/admin.service";

const adminService = new AdminService();

const isOrderStatus = (value: unknown): value is OrderStatus => {
  if (typeof value !== "string") return false;
  return (Object.values(OrderStatus) as string[]).includes(value);
};

type AuditDecision = "APPROVE" | "REJECT";

const normalizeDecision = (value: unknown): AuditDecision | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v === "APPROVE") return "APPROVE";
  if (v === "REJECT") return "REJECT";
  if (v === "PASS") return "APPROVE";
  if (v === "REFUSE") return "REJECT";
  return null;
};

export const cancelOrder: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const { reason } = req.body as Partial<{ reason: string }>;

    const order = await adminService.cancelOrder({
      adminId: user.id,
      orderId,
      reason: reason ?? null,
    });

    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const setOrderStatus: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const { status, reason } = req.body as Partial<{ status: string; reason: string }>;

    if (!isOrderStatus(status)) {
      res.status(400).json({ error: "status 不合法" });
      return;
    }

    const order = await adminService.setOrderStatus({
      adminId: user.id,
      orderId,
      status,
      reason: reason ?? null,
    });

    res.status(200).json({ order });
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const withdrawList: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminService.listWithdraws({
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const auditWithdraw: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const withdrawId = Number.parseInt(String(req.params.withdrawId ?? ""), 10);
    const { decision, reason, status } = req.body as Partial<{
      decision: string;
      status: string;
      reason: string;
    }>;

    const normalized = normalizeDecision(decision ?? status);
    if (!normalized) {
      res.status(400).json({ error: "decision 不合法" });
      return;
    }

    const withdraw = await adminService.auditWithdraw({
      adminId: user.id,
      withdrawId,
      decision: normalized,
      reason: reason ?? null,
    });

    res.status(200).json({ withdraw });
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
