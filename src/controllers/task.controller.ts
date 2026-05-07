import type { RequestHandler } from "express";
import { TaskError, TaskService } from "../services/task.service";
import { sensitiveWordService } from "../services/sensitiveWord.service";

const taskService = new TaskService();

export const publish: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const {
      pickup_address,
      pickup_lat,
      pickup_lng,
      delivery_address,
      delivery_lat,
      delivery_lng,
      type,
      urgency,
      remark,
      images_json,
      weight,
      size,
      is_fragile,
      need_inspection,
      fee_total,
      tip,
      scheduled_time,
    } = req.body as Partial<Record<string, unknown>>;

    const remarkMatch = await sensitiveWordService.matchText(remark);
    if (remarkMatch.matched) {
      throw new TaskError(400, "任务备注包含敏感词");
    }

    const task = await taskService.publish({
      publisherId: user.id,
      pickup_address: String(pickup_address ?? ""),
      pickup_lat: pickup_lat as string | number | null | undefined,
      pickup_lng: pickup_lng as string | number | null | undefined,
      delivery_address: String(delivery_address ?? ""),
      delivery_lat: delivery_lat as string | number | null | undefined,
      delivery_lng: delivery_lng as string | number | null | undefined,
      type: String(type ?? ""),
      urgency: urgency as number | null | undefined,
      remark: (remark === undefined ? null : (remark as string | null)) ?? null,
      images_json,
      weight: weight === undefined ? null : String(weight),
      size: size === undefined ? null : String(size),
      is_fragile:
        typeof is_fragile === "boolean"
          ? is_fragile
          : typeof is_fragile === "number"
            ? is_fragile === 1
            : typeof is_fragile === "string"
              ? ["1", "true", "yes", "on"].includes(is_fragile.trim().toLowerCase())
              : null,
      need_inspection:
        typeof need_inspection === "boolean"
          ? need_inspection
          : typeof need_inspection === "number"
            ? need_inspection === 1
            : typeof need_inspection === "string"
              ? ["1", "true", "yes", "on"].includes(need_inspection.trim().toLowerCase())
              : null,
      fee_total: fee_total as string | number,
      tip: tip as string | number | null | undefined,
      scheduled_time: scheduled_time as string | number | Date | null | undefined,
    });

    res.status(201).json({ task });
  } catch (err) {
    if (err instanceof TaskError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const list: RequestHandler = async (req, res, next) => {
  try {
    const result = await taskService.getTaskList({
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      lat: req.query.lat !== undefined ? Number(req.query.lat) : undefined,
      lng: req.query.lng !== undefined ? Number(req.query.lng) : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TaskError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getNearbyTasks: RequestHandler = async (req, res, next) => {
  try {
    const result = await taskService.getNearbyTasks({
      lat: Number(req.query.lat),
      lng: Number(req.query.lng),
      radius: req.query.radius !== undefined ? Number(req.query.radius) : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TaskError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const nearby: RequestHandler = async (req, res, next) => {
  return getNearbyTasks(req, res, next);
};

export const detail: RequestHandler = async (req, res, next) => {
  try {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    const task = await taskService.detail(id);
    res.status(200).json({ task });
  } catch (err) {
    if (err instanceof TaskError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const cancelTask: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const taskId = Number.parseInt(String(req.params.taskId ?? ""), 10);
    const result = await taskService.cancelTask({ taskId, publisherId: user.id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof TaskError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
