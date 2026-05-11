import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { info, recharge } from "../controllers/wallet.controller";

const router = Router();

router.get("/info", requireAuth, info);
router.post("/recharge", requireAuth, recharge);

export default router;
