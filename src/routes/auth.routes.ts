import { Router } from "express";
import { authStatus, login, me, register, submitAuth } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);

export const userAuthRouter = Router();
userAuthRouter.post("/auth", requireAuth, submitAuth);
userAuthRouter.get("/auth-status", requireAuth, authStatus);

export default router;
