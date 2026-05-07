import type { RequestHandler } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { extFromMimeType, uploadsDir } from "../middleware/upload.middleware";

const ensureUploadsDir = () => {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
};

const createFilename = (ext: string) => {
  const rand = crypto.randomInt(100000, 1000000);
  return `${Date.now()}-${rand}${ext}`;
};

export const uploadImage: RequestHandler = (req, res) => {
  const files: Array<{ filename: string }> = [];

  const filesObj = (req as unknown as { files?: unknown }).files;
  if (Array.isArray(filesObj)) {
    for (const f of filesObj) {
      if (f && typeof (f as { filename?: unknown }).filename === "string") {
        files.push({ filename: (f as { filename: string }).filename });
      }
    }
  } else if (filesObj && typeof filesObj === "object") {
    for (const group of Object.values(filesObj as Record<string, unknown>)) {
      if (!Array.isArray(group)) continue;
      for (const f of group) {
        if (f && typeof (f as { filename?: unknown }).filename === "string") {
          files.push({ filename: (f as { filename: string }).filename });
        }
      }
    }
  }

  if (files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }

  const urls = files.map((f) => `/uploads/${f.filename}`);
  res.status(201).json({ urls });
};

export const uploadAvatar: RequestHandler = async (req, res, next) => {
  try {
    const file = (req as unknown as { file?: unknown }).file as
      | { buffer: Buffer; mimetype: string }
      | undefined;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    ensureUploadsDir();

    const ext = extFromMimeType(file.mimetype) || ".jpg";
    const filename = createFilename(ext);
    const outputPath = path.join(uploadsDir, filename);

    const transformer = sharp(file.buffer).resize(200, 200, { fit: "cover", position: "centre" });

    if (ext === ".png") {
      await transformer.png().toFile(outputPath);
    } else if (ext === ".webp") {
      await transformer.webp().toFile(outputPath);
    } else {
      await transformer.jpeg().toFile(outputPath);
    }

    res.status(201).json({ url: `/uploads/${filename}` });
  } catch (err) {
    next(err);
  }
};
