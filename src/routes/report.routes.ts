import { Router } from "express";
import { create } from "../controllers/report.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.post("/:orderId/report", requireAuth, requireRole("RUNNER"), create);

export default router;

