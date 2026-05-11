import type { RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createFilename, extFromMimeType, uploadsDir } from "../middleware/upload.middleware";
import {
  switchRole as switchRoleService,
  UserError,
  updateProfile as updateProfileService,
} from "../services/user.service";

const prisma = new PrismaClient();

const avatarsDir = path.join(uploadsDir, "avatars");

const ensureAvatarsDir = async () => {
  await fs.promises.mkdir(avatarsDir, { recursive: true });
};

const toUploadsRelativePath = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return null;
    }
  }

  const idx = pathname.indexOf("/uploads/");
  if (idx >= 0) pathname = pathname.slice(idx);

  if (!pathname.startsWith("/uploads/")) return null;
  return pathname.replace(/^\/uploads\//, "");
};

const toSafeUploadAbsPath = (uploadsRelativePath: string): string | null => {
  const root = path.resolve(uploadsDir);
  const abs = path.resolve(uploadsDir, uploadsRelativePath);
  if (abs === root) return null;
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
};

const deleteOldAvatarIfAny = async (oldAvatarUrl: string | null | undefined) => {
  if (!oldAvatarUrl) return;
  const rel = toUploadsRelativePath(oldAvatarUrl);
  if (!rel) return;

  const absPath = toSafeUploadAbsPath(rel);
  if (!absPath) return;

  await fs.promises.unlink(absPath).catch(() => {});
};

export const uploadAvatar: RequestHandler = async (req, res, next) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const file = (req as unknown as { file?: unknown }).file as
    | { buffer: Buffer; mimetype: string }
    | undefined;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  let createdAbsPath: string | null = null;

  try {
    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatar: true },
    });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await ensureAvatarsDir();

    const ext = extFromMimeType(file.mimetype) || ".jpg";
    const filename = createFilename(ext);
    createdAbsPath = path.join(avatarsDir, filename);

    const transformer = sharp(file.buffer).resize(200, 200, { fit: "cover", position: "centre" });

    if (ext === ".png") {
      await transformer.png().toFile(createdAbsPath);
    } else if (ext === ".webp") {
      await transformer.webp().toFile(createdAbsPath);
    } else {
      await transformer.jpeg().toFile(createdAbsPath);
    }

    const url = `/uploads/avatars/${filename}`;

    await prisma.user.update({
      where: { id: user.id },
      data: { avatar: url },
    });

    if (existing.avatar && existing.avatar !== url) {
      await deleteOldAvatarIfAny(existing.avatar);
    }

    res.status(201).json({ url });
  } catch (err) {
    if (createdAbsPath) {
      await fs.promises.unlink(createdAbsPath).catch(() => {});
    }
    next(err);
  }
};

export const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { nickname, phone, avatar } = req.body as Partial<{
      nickname: unknown;
      phone: unknown;
      avatar: unknown;
    }>;

    const hasAnyField = nickname !== undefined || phone !== undefined || avatar !== undefined;
    if (!hasAnyField) {
      res.status(400).json({ error: "至少需要修改一个字段" });
      return;
    }

    if (nickname !== undefined && typeof nickname !== "string") {
      res.status(400).json({ error: "nickname 不合法" });
      return;
    }
    if (phone !== undefined && typeof phone !== "string") {
      res.status(400).json({ error: "phone 不合法" });
      return;
    }
    if (avatar !== undefined && typeof avatar !== "string") {
      res.status(400).json({ error: "avatar 不合法" });
      return;
    }

    const trimmedNickname = typeof nickname === "string" ? (nickname ? nickname.trim() : "") : "";
    const trimmedPhone = typeof phone === "string" ? (phone ? phone.trim() : "") : "";
    const trimmedAvatar = typeof avatar === "string" ? (avatar ? avatar.trim() : "") : "";

    const normalizedNickname = nickname === undefined ? undefined : (trimmedNickname ? trimmedNickname : null);
    const normalizedPhone = phone === undefined ? undefined : (trimmedPhone ? trimmedPhone : null);
    const normalizedAvatar = avatar === undefined ? undefined : (trimmedAvatar ? trimmedAvatar : null);

    const updated = await updateProfileService({
      userId: user.id,
      nickname: normalizedNickname,
      phone: normalizedPhone,
      avatar: normalizedAvatar,
    });

    res.status(200).json({ user: updated });
  } catch (err) {
    if (err instanceof UserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const switchRole: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const updated = await switchRoleService({ userId: user.id });
    res.status(200).json({ user: updated });
  } catch (err) {
    if (err instanceof UserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
