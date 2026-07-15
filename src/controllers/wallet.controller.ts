import type { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { WalletError, getWalletInfo, recharge as rechargeService } from "../services/wallet.service";

const prisma = new PrismaClient();

// 获取钱包信息
export const info: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await getWalletInfo(user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof WalletError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

// 充值
export const recharge: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { amount } = req.body as Partial<{ amount: string | number }>;
    const result = await rechargeService(user.id, amount ?? "");
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof WalletError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

// 获取钱包流水
export const getWalletLogs: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const type = req.query.type as string;

    const where: any = {
      wallet: { user_id: user.id }
    };

    // 按类型筛选
    if (type && type !== 'all' && type !== '') {
      where.type = type;
    }

    const [items, total] = await Promise.all([
      prisma.walletLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletLog.count({ where }),
    ]);

    res.json({
      items,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
};