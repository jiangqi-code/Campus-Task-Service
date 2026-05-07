import type { RequestHandler } from "express";
import { WithdrawError, WithdrawService } from "../services/withdraw.service";

const withdrawService = new WithdrawService();

export const apply: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { amount } = req.body as Partial<{ amount: string | number }>;
    const withdraw = await withdrawService.apply({
      userId: user.id,
      amount: amount ?? "",
    });

    res.status(201).json({ withdraw });
  } catch (err) {
    if (err instanceof WithdrawError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const list: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await withdrawService.listMyWithdraws({
      userId: user.id,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof WithdrawError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
