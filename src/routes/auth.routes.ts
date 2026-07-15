// backend/src/routes/auth.routes.ts

import { Router } from "express";
import {
  authStatus,
  login,
  me,
  register,
  submitAuth,
  applyRunner,
  applyStatus,
  getAuthList,    // 👈 添加导入
  auditAuth       // 👈 添加导入
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// 公开路由
router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);

// 用户认证路由
export const userAuthRouter = Router();
userAuthRouter.post("/auth", requireAuth, submitAuth);
userAuthRouter.get("/auth-status", requireAuth, authStatus);
userAuthRouter.post("/apply-runner", requireAuth, applyRunner);
userAuthRouter.get("/apply-status", requireAuth, applyStatus);

// ========== 管理员审核路由 ==========
// 获取入驻申请列表
router.get("/admin/auth/list", requireAuth, getAuthList);
// 审核入驻申请（通过/拒绝）
router.post("/admin/auth/:authId/audit", requireAuth, auditAuth);

export default router;
