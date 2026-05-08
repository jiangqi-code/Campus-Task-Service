import { Router } from "express";
import { createComplaint } from "../controllers/complaint.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/:orderId/complaint", requireAuth, createComplaint);

export default router;

