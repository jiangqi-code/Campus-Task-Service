import type { RequestHandler } from "express";
import { Role } from "@prisma/client";
import { getStatistics as getStatisticsService, RunnerError } from "../services/runner.service";

export const getStatistics: RequestHandler = async (req, res, next) => {
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

    const result = await getStatisticsService(user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof RunnerError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

