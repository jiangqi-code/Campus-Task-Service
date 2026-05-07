import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { create } from "../controllers/review.controller";

const router = Router();

router.post("/:orderId/review", requireAuth, create);

export default router;

