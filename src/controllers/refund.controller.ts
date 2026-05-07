import type { RequestHandler } from "express";
import { RefundError, refundService } from "../services/refund.service";

export const applyRefund: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const reason = (req.body as { reason?: unknown } | undefined)?.reason;

    const refund = await refundService.applyRefund({ orderId, userId: user.id, reason });
    res.status(201).json({ refund });
  } catch (err) {
    if (err instanceof RefundError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getRefundList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { page, pageSize, status } = req.query as Partial<Record<string, unknown>>;
    const result = await refundService.listRefunds({ page, pageSize, status });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RefundError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const auditRefund: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const refundId = Number.parseInt(String(req.params.refundId ?? ""), 10);
    const action = (req.body as { action?: unknown } | undefined)?.action;

    const refund = await refundService.auditRefund({ adminId: user.id, refundId, action });
    res.status(200).json({ refund });
  } catch (err) {
    if (err instanceof RefundError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
