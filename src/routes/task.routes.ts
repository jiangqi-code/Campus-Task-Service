import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { cancelTask, detail, getNearbyTasks, list, publish } from "../controllers/task.controller";

const router = Router();

router.post("/publish", requireAuth, publish);
router.delete("/:taskId/cancel", requireAuth, cancelTask);
router.get("/nearby", getNearbyTasks);
router.get("/list", list);
router.get("/detail/:id", detail);

export default router;
