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

type FreezeAction = "freeze" | "unfreeze";

const normalizeFreezeAction = (value: unknown): FreezeAction | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "freeze") return "freeze";
  if (v === "unfreeze") return "unfreeze";
  return null;
};

export const getDashboard: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getDashboard();
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const userList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.userList({
      page: req.query.page,
      pageSize: req.query.pageSize,
      keyword: req.query.keyword,
      role: req.query.role,
      status: req.query.status,
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

export const getLogs: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getLogs({
      page: req.query.page,
      pageSize: req.query.pageSize,
      adminId: req.query.admin_id,
      action: req.query.action,
      targetType: req.query.target_type,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
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

export const freezeUser: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = Number.parseInt(String(req.params.userId ?? ""), 10);
    const { action } = req.body as Partial<{ action: string }>;

    const normalized = normalizeFreezeAction(action);
    if (!normalized) {
      res.status(400).json({ error: "action 不合法" });
      return;
    }

    const updated = await adminService.freezeUser({
      adminId: user.id,
      userId,
      action: normalized,
    });

    res.status(200).json({ user: updated });
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const deleteUser: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = Number.parseInt(String(req.params.userId ?? ""), 10);
    const result = await adminService.deleteUser({ adminId: user.id, userId });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const taskList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getTaskList({
      adminId: user.id,
      page: req.query.page,
      pageSize: req.query.pageSize,
      keyword: req.query.keyword,
      status: req.query.status,
      type: req.query.type,
      publisherId: req.query.publisher_id ?? req.query.publisherId,
      startDate: req.query.start_date ?? req.query.startDate,
      endDate: req.query.end_date ?? req.query.endDate,
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

export const deleteTask: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const taskId = Number.parseInt(String(req.params.taskId ?? ""), 10);
    const result = await adminService.deleteTask({ adminId: user.id, taskId });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
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

export const orderList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.orderList({
      adminId: user.id,
      page: req.query.page,
      pageSize: req.query.pageSize,
      keyword: req.query.keyword,
      status: req.query.status,
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

export const getConfig: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getConfig({ adminId: user.id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const updateConfig: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const key = String(req.params.key ?? "").trim();
    const { value } = req.body as Partial<{ value: unknown }>;

    if (!key) {
      res.status(400).json({ error: "key 不合法" });
      return;
    }
    if (typeof value !== "string" || !value.trim()) {
      res.status(400).json({ error: "value 不合法" });
      return;
    }

    const result = await adminService.updateConfig({
      adminId: user.id,
      key,
      value,
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

export const getSensitiveWords: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getSensitiveWords({ adminId: user.id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const addSensitiveWord: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { word } = req.body as Partial<{ word: unknown }>;
    if (typeof word !== "string" || !word.trim()) {
      res.status(400).json({ error: "word 不合法" });
      return;
    }

    const result = await adminService.addSensitiveWord({ adminId: user.id, word });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const deleteSensitiveWord: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id 不合法" });
      return;
    }

    const result = await adminService.deleteSensitiveWord({ adminId: user.id, id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AdminError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
