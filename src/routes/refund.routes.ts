import { Router } from "express";
import { applyRefund } from "../controllers/refund.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/:orderId/refund", requireAuth, applyRefund);

export default router;
