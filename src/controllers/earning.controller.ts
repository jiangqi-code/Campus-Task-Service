import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import { EarningError, getDashboard as getDashboardService, getSummary as getSummaryService } from "../services/earning.service";

export const getSummary: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.role !== Role.RUNNER) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    const summary = await getSummaryService(user.id);
    res.status(200).json(summary);
  } catch (err) {
    if (err instanceof EarningError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getDashboard: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    if (user.role !== Role.RUNNER) return void res.status(403).json({ error: "无权限" });
    const result = await getDashboardService(user.id, Number(req.query.page), Number(req.query.pageSize), Number(req.query.days));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof EarningError) return void res.status(err.status).json({ error: err.message });
    next(err);
  }
};
