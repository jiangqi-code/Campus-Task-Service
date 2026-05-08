import type { RequestHandler } from "express";
import { AdminError, AdminService } from "../services/admin.service";
import { ComplaintError, complaintService } from "../services/complaint.service";

const adminService = new AdminService();

export const createComplaint: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const body = req.body as { reason?: unknown; description?: unknown; photos?: unknown } | undefined;

    const complaint = await complaintService.createComplaint({
      orderId,
      userId: user.id,
      reason: body?.reason,
      description: body?.description,
      photos: body?.photos,
    });

    res.status(201).json({ complaint });
  } catch (err) {
    if (err instanceof ComplaintError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getComplaintList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { page, pageSize, status } = req.query as Partial<Record<string, unknown>>;
    const result = await complaintService.listComplaints({ page, pageSize, status });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ComplaintError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const processComplaint: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const complaintId = Number.parseInt(String(req.params.complaintId ?? ""), 10);
    const body = req.body as { action?: unknown; admin_note?: unknown } | undefined;

    const complaint = await adminService.processComplaint({
      adminId: user.id,
      complaintId,
      action: body?.action,
      admin_note: body?.admin_note,
    });

    res.status(200).json({ complaint });
  } catch (err) {
    if (err instanceof AdminError || err instanceof ComplaintError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
