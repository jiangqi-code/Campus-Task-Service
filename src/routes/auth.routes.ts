import { Router } from "express";
import { login, me, register, submitAuth } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);

export const userAuthRouter = Router();
userAuthRouter.post("/auth", requireAuth, submitAuth);

export default router;
