import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { apply, list } from "../controllers/withdraw.controller";

const router = Router();

router.post("/apply", requireAuth, apply);
router.get("/list", requireAuth, list);

export default router;
