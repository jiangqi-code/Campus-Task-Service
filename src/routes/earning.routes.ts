import { Router } from "express";
import { getDashboard, getSummary } from "../controllers/earning.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.get("/summary", requireAuth, requireRole("RUNNER"), getSummary);
router.get("/dashboard", requireAuth, requireRole("RUNNER"), getDashboard);

export default router;
