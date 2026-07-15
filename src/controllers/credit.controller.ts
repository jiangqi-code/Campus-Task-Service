import type { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { getCreditLevel } from "../services/credit.service";

const prisma = new PrismaClient();

type CreditRuleItem = {
  code: string;
  name: string;
  delta: number;
  description: string;
};

const CREDIT_RULES: CreditRuleItem[] = [
  { code: "ORDER_COMPLETE", name: "完成订单", delta: 2, description: "骑手将订单完成" },
  { code: "ON_TIME_BONUS", name: "准时送达奖励", delta: 1, description: "在预计送达时间内完成订单" },
  { code: "REVIEW_5_STAR", name: "五星好评", delta: 3, description: "订单评价为 5 星" },
  { code: "REVIEW_LOW_STAR", name: "差评扣分", delta: -5, description: "订单评价为 1-2 星" },
  { code: "ORDER_CANCEL_AFTER_ACCEPT", name: "接单后取消", delta: -10, description: "订单在已接单后被取消" },
  { code: "TIMEOUT_NO_PICKUP", name: "接单未取货超时", delta: -8, description: "接单后长时间未取货导致订单取消" },
  { code: "COMPLAINT_VERIFIED", name: "投诉核实扣分", delta: -20, description: "投诉成立后扣分" },
  { code: "REPORT_DEDUCT", name: "被举报扣分", delta: -5, description: "举报成立后扣分" },
  { code: "ADMIN_ADJUST", name: "管理员调整", delta: 0, description: "管理员可手动加减分" },
];

const getNextLevelInfo = (score: number) => {
  const s = Number.isFinite(score) ? Math.trunc(score) : 0;
  const current = getCreditLevel(s);

  if (current === "青铜") {
    const target = 301;
    return { next_level_name: "白银" as const, need_score: Math.max(0, target - s) };
  }
  if (current === "白银") {
    const target = 601;
    return { next_level_name: "黄金" as const, need_score: Math.max(0, target - s) };
  }
  if (current === "黄金") {
    const target = 801;
    return { next_level_name: "钻石" as const, need_score: Math.max(0, target - s) };
  }

  return { next_level_name: null as null, need_score: 0 };
};

export const getScore: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const found = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, status: true, credit_score: true },
    });

    if (!found || found.status === -1) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }

    const credit_score = found.credit_score ?? 0;
    const credit_level = getCreditLevel(credit_score);
    const { next_level_name, need_score } = getNextLevelInfo(credit_score);

    res.status(200).json({
      credit_score,
      credit_level,
      next_level_name,
      need_score,
    });
  } catch (err) {
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

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 10));
    const skip = (page - 1) * pageSize;

    const where = { user_id: user.id };

    const [items, total] = await Promise.all([
      prisma.creditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.creditLog.count({ where }),
    ]);

    res.status(200).json({ items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
};

export const getRules: RequestHandler = async (_req, res) => {
  res.status(200).json({ items: CREDIT_RULES });
};
