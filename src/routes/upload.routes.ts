import { Router } from "express";
import { uploadAvatar, uploadImage } from "../controllers/upload.controller";
import { ensureUploadsDirExists, uploadAvatar as uploadAvatarMiddleware, uploadImage as uploadImageMiddleware } from "../middleware/upload.middleware";

const router = Router();

router.post("/image", ensureUploadsDirExists, uploadImageMiddleware, uploadImage);
router.post("/avatar", ensureUploadsDirExists, uploadAvatarMiddleware, uploadAvatar);

export default router;
