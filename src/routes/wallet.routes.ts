import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { info, recharge, getWalletLogs } from "../controllers/wallet.controller";

const router = Router();

router.get("/info", requireAuth, info);
router.post("/recharge", requireAuth, recharge);
router.get("/logs", requireAuth, getWalletLogs);  // ← 添加这行

export default router;