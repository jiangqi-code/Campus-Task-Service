import type { RequestHandler } from "express";
import { PrismaClient, Role } from "@prisma/client";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createFilename, extFromMimeType, uploadsDir } from "../middleware/upload.middleware";
import {
  getUserInfo as getUserInfoService,
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

  await fs.promises.unlink(absPath).catch(() => { });
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
      await fs.promises.unlink(createdAbsPath).catch(() => { });
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

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true, status: true },
    });
    if (!dbUser || dbUser.status === -1) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }

    const nextRole =
      dbUser.role === Role.USER ? Role.RUNNER : dbUser.role === Role.RUNNER ? Role.USER : null;

    if (nextRole === Role.RUNNER) {
      const auth = await prisma.userAuth.findUnique({
        where: { user_id: user.id },
        select: { audit_status: true },
      });

      const status = (auth?.audit_status ?? "").trim().toUpperCase();
      if (status !== "APPROVED") {
        res.status(403).json({ error: "请先申请并通过跑腿员审核" });
        return;
      }
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

export const getUserInfo: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rawUserId = req.params.userId;
    const userId = Number.parseInt(rawUserId, 10);
    if (!Number.isFinite(userId) || String(userId) !== rawUserId.trim()) {
      next();
      return;
    }

    const result = await getUserInfoService({ userId });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof UserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

// 用户申请解封
export const applyUnfreeze: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ✅ 直接从数据库查询最新状态，而不是用 req.user 中的缓存
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true }
    });

    if (!dbUser) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }

    // 检查用户是否真的是冻结状态
    if (dbUser.status !== 0) {
      res.status(400).json({ error: "账号未被冻结，无需申请解封" });
      return;
    }

    const { reason, contact } = req.body as { reason?: string; contact?: string };

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ error: "请填写申请理由" });
      return;
    }

    // 检查是否已有未处理的申请
    const existing = await prisma.unfreezeApplication.findFirst({
      where: {
        user_id: user.id,
        status: "PENDING"
      }
    });

    if (existing) {
      res.status(409).json({ error: "已有正在处理中的解封申请，请耐心等待" });
      return;
    }

    const application = await prisma.unfreezeApplication.create({
      data: {
        user_id: user.id,
        reason: reason.trim(),
        contact: contact?.trim() || null,
        status: "PENDING"
      }
    });

    res.status(201).json({
      success: true,
      message: "解封申请已提交，管理员将在1-3个工作日内处理",
      application: {
        id: application.id,
        status: application.status,
        created_at: application.created_at
      }
    });
  } catch (err) {
    next(err);
  }
};
