import type { RequestHandler } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

const uploadsDir = path.join(process.cwd(), "uploads");

const ensureUploadsDir = () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
};

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const extFromMimeType = (mimeType: string) => {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return "";
};

const createFilename = (ext: string) => {
  const rand = crypto.randomInt(100000, 1000000);
  return `${Date.now()}-${rand}${ext}`;
};

type FileFilterCb = (error: Error | null, acceptFile?: boolean) => void;
type MulterFileLike = { mimetype: string; originalname: string };

const fileFilter = (_req: unknown, file: MulterFileLike, cb: FileFilterCb) => {
  if (allowedMimeTypes.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error("仅支持 JPG、PNG、WebP 图片"));
};

const diskStorage = multer.diskStorage({
  destination: (_req: unknown, _file: unknown, cb: (error: Error | null, destination: string) => void) => {
    ensureUploadsDir();
    cb(null, uploadsDir);
  },
  filename: (_req: unknown, file: MulterFileLike, cb: (error: Error | null, filename: string) => void) => {
    const ext = extFromMimeType(file.mimetype) || path.extname(file.originalname) || ".jpg";
    cb(null, createFilename(ext));
  },
});

const imageUpload = multer({
  storage: diskStorage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 3,
  },
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
});

export const uploadImage: RequestHandler = (req, res, next) => {
  imageUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "images", maxCount: 3 },
    { name: "photo", maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "图片不能超过 10MB" : `图片上传失败：${err.code}`,
      });
      return;
    }

    res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
  });
};

export const uploadAvatar: RequestHandler = (req, res, next) => {
  avatarUpload.single("avatar")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "头像不能超过 2MB" : `头像上传失败：${err.code}`,
      });
      return;
    }

    res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
  });
};

export const ensureUploadsDirExists: RequestHandler = (_req, _res, next) => {
  try {
    ensureUploadsDir();
    next();
  } catch {
    const error = new Error("上传目录不可写，请检查服务器目录权限");
    (error as Error & { statusCode?: number }).statusCode = 500;
    next(error);
  }
};

export { uploadsDir, extFromMimeType, createFilename };
