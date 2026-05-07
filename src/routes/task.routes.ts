import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { limitTaskPublish } from "../middleware/rateLimit.middleware";
import { cancelTask, detail, getNearbyTasks, list, publish } from "../controllers/task.controller";
import { containsSensitiveWord } from "../services/sensitiveWord.service";

const router = Router();

const rejectSensitivePublishFields: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const remark = body.remark;
    const type = body.type;

    if (await containsSensitiveWord(remark)) {
      res.status(400).json({ error: "任务备注包含敏感词" });
      return;
    }
    if (await containsSensitiveWord(type)) {
      res.status(400).json({ error: "物品类型包含敏感词" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};

router.post("/publish", requireAuth, limitTaskPublish, rejectSensitivePublishFields, publish);
router.delete("/:taskId/cancel", requireAuth, cancelTask);
router.get("/nearby", getNearbyTasks);
router.get("/list", list);
router.get("/detail/:id", detail);

export default router;
