import type { RequestHandler } from "express";
import { WalletError, recharge as rechargeService } from "../services/wallet.service";

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
