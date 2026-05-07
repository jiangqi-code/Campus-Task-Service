import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import { EarningError, getSummary as getSummaryService } from "../services/earning.service";

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
