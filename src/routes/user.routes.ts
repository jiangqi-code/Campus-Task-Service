import { Router } from "express";
import { switchRole, updateProfile, uploadAvatar } from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadAvatar as uploadAvatarMiddleware } from "../middleware/upload.middleware";

const router = Router();

router.post("/avatar", requireAuth, uploadAvatarMiddleware, uploadAvatar);
router.put("/profile", requireAuth, updateProfile);
router.put("/switch-role", requireAuth, switchRole);

export default router;
