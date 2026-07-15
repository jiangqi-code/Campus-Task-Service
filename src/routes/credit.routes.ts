import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { getLogs, getRules, getScore } from "../controllers/credit.controller";

const router = Router();

router.get("/score", requireAuth, getScore);
router.get("/logs", requireAuth, getLogs);
router.get("/rules", requireAuth, getRules);

export default router;

