import { Router } from "express";
import { getStatistics } from "../controllers/runner.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.get("/statistics", requireAuth, requireRole("RUNNER"), getStatistics);

export default router;

