import { Router } from "express";
import { applyRecommend, getRecommend, switchAiPricing } from "../controllers/adminPricing.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.get("/recommend", requireAuth, requireRole("ADMIN"), getRecommend);
router.post("/apply", requireAuth, requireRole("ADMIN"), applyRecommend);
router.put("/switch", requireAuth, requireRole("ADMIN"), switchAiPricing);

export default router;

