import { Router } from "express";
import { getSummary } from "../controllers/earning.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.get("/summary", requireAuth, requireRole("RUNNER"), getSummary);

export default router;
