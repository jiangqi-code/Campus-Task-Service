import type { RequestHandler } from "express";
// 手动声明 OrderStatus 枚举，解决找不到 @prisma/client 类型声明的问题
enum OrderStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  SHIPPED = "SHIPPED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}
import { AdminError, AdminService } from "../services/admin.service";
import { ExportError, exportOrders as exportOrdersService } from "../services/export.service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
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

export const getHeatmapData: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getHeatmapData({
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

export const getLoginLogs: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getLoginLogs({
      page: req.query.page,
      pageSize: req.query.pageSize,
      userId: req.query.user_id,
      keyword: req.query.keyword,
      ip: req.query.ip,
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

export const getErrorLogs: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await adminService.getErrorLogs({
      page: req.query.page,
      pageSize: req.query.pageSize,
      userId: req.query.user_id,
      keyword: req.query.keyword,
      url: req.query.url,
      method: req.query.method,
      ip: req.query.ip,
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

export const resetPassword: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = Number.parseInt(String(req.params.userId ?? ""), 10);
    const { password } = req.body as Partial<{ password: string }>;

    if (!password || typeof password !== 'string' || password.trim().length < 6) {
      res.status(400).json({ error: "密码不能少于6位" });
      return;
    }

    const result = await adminService.resetPassword({
      adminId: user.id,
      userId,
      newPassword: password.trim()
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

export const exportOrders: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const file = await exportOrdersService({
      status: req.query.status,
      startDate: req.query.start_date ?? req.query.startDate,
      endDate: req.query.end_date ?? req.query.endDate,
      format: req.query.format,
    });

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.status(200).send(file.data);
  } catch (err) {
    if (err instanceof ExportError) {
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

// ==================== 解封审核接口 ====================

// 获取解封申请列表
export const getUnfreezeApplications: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const skip = (page - 1) * pageSize;
    const status = req.query.status as string;

    const where: any = {};
    if (status && status !== 'all') {
      where.status = status;
    }

    const [total, items] = await Promise.all([
      prisma.unfreezeApplication.count({ where }),
      prisma.unfreezeApplication.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              nickname: true,
              student_id: true,
              phone: true,
              status: true
            }
          },
          admin: {
            select: { id: true, nickname: true }
          }
        }
      })
    ]);

    res.json({ page, pageSize, total, items });
  } catch (err) {
    next(err);
  }
};

// 处理解封申请（通过/拒绝）
export const processUnfreezeApplication: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const id = parseInt(req.params.id);
    const { action, admin_note } = req.body as { action: "approve" | "reject"; admin_note?: string };

    if (!action || (action !== "approve" && action !== "reject")) {
      res.status(400).json({ error: "action 必须为 approve 或 reject" });
      return;
    }

    const application = await prisma.unfreezeApplication.findUnique({ where: { id } });
    if (!application) {
      res.status(404).json({ error: "申请不存在" });
      return;
    }
    if (application.status !== "PENDING") {
      res.status(409).json({ error: "该申请已被处理" });
      return;
    }

    // 更新申请状态
    await prisma.unfreezeApplication.update({
      where: { id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        admin_note: admin_note || null,
        admin_id: user.id,
        processed_at: new Date()
      }
    });

    // 如果通过，解封用户
    if (action === "approve") {
      await prisma.user.update({
        where: { id: application.user_id },
        data: { status: 1 }
      });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
export const getRefundList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const skip = (page - 1) * pageSize;
    const status = req.query.status as string;

    const where: any = {};
    if (status && status !== 'all') {
      where.status = status;
    }

    const [total, items] = await Promise.all([
      prisma.refund.count({ where }),
      prisma.refund.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
        include: {
          user: {
            select: { id: true, nickname: true, student_id: true, phone: true }
          },
          runner: {
            select: { id: true, nickname: true, student_id: true }
          },
          audit_admin: {
            select: { id: true, nickname: true }
          }
        }
      })
    ]);

    res.json({ page, pageSize, total, items });
  } catch (err) {
    next(err);
  }
};

// 审核退款申请
export const auditRefund: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const refundId = parseInt(req.params.refundId);
    const { decision, reason } = req.body as { decision: "APPROVE" | "REJECT"; reason?: string };

    if (!decision || (decision !== "APPROVE" && decision !== "REJECT")) {
      res.status(400).json({ error: "decision 必须为 APPROVE 或 REJECT" });
      return;
    }

    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: { user: true, runner: true }
    });

    if (!refund) {
      res.status(404).json({ error: "退款申请不存在" });
      return;
    }
    if (refund.status !== "PENDING") {
      res.status(409).json({ error: "该申请已被处理" });
      return;
    }

    // 更新申请状态
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        audit_time: new Date(),
        audit_admin_id: user.id
      }
    });

    // 如果通过，执行退款操作
    if (decision === "APPROVE") {
      await prisma.$transaction(async (tx) => {
        // 获取用户钱包
        let userWallet = await tx.userWallet.findUnique({
          where: { user_id: refund.user_id }
        });

        if (!userWallet) {
          userWallet = await tx.userWallet.create({
            data: { user_id: refund.user_id, balance: 0, frozen: 0 }
          });
        }

        // 获取当前实时余额（不使用 frozen，只退款到可用余额）
        const beforeBalance = Number(userWallet.balance);
        const refundAmount = Number(refund.amount);
        const afterBalance = beforeBalance + refundAmount;

        console.log('[auditRefund] 退款前余额:', beforeBalance);
        console.log('[auditRefund] 退款金额:', refundAmount);
        console.log('[auditRefund] 退款后余额:', afterBalance);

        // 更新用户余额
        await tx.userWallet.update({
          where: { id: userWallet.id },
          data: { balance: afterBalance }
        });

        // 记录钱包流水
        await tx.walletLog.create({
          data: {
            wallet_id: userWallet.id,
            type: "REFUND",
            amount: refundAmount,
            ref_order_id: refund.order_id,
            before_balance: beforeBalance,
            after_balance: afterBalance
          }
        });
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('auditRefund error:', err);
    next(err);
  }
};