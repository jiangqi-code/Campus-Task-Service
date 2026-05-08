import type { RequestHandler } from "express";
import { ReportError, reportService } from "../services/report.service";

export const create: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const orderId = Number.parseInt(String(req.params.orderId ?? ""), 10);
    const { type, description, photos } = req.body as Partial<Record<string, unknown>>;

    const report = await reportService.createReport({
      orderId,
      runnerId: user.id,
      type,
      description,
      photos,
    });

    res.status(201).json({ report });
  } catch (err) {
    if (err instanceof ReportError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getReportList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { page, pageSize, orderId, runnerId, type, keyword } = req.query as Partial<Record<string, unknown>>;
    const result = await reportService.listReportsForAdmin({ page, pageSize, orderId, runnerId, type, keyword });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ReportError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

