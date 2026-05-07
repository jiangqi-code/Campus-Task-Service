import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { recharge } from "../controllers/wallet.controller";

const router = Router();

router.post("/recharge", requireAuth, recharge);

export default router;
