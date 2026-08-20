import type { RequestHandler } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createFilename, extFromMimeType, uploadsDir } from "../middleware/upload.middleware";

const ensureUploadsDir = () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
};

const thumbnailsDir = path.join(uploadsDir, "thumbs");

type UploadedImageFile = {
  filename: string;
  mimetype: string;
  path: string;
};

const collectUploadedFiles = (req: unknown) => {
  const files: UploadedImageFile[] = [];

  const filesObj = (req as unknown as { files?: unknown }).files;
  if (Array.isArray(filesObj)) {
    for (const f of filesObj) {
      const file = f as Partial<UploadedImageFile> | undefined;
      if (file?.filename && file.path && file.mimetype) {
        files.push(file as UploadedImageFile);
      }
    }
  } else if (filesObj && typeof filesObj === "object") {
    for (const group of Object.values(filesObj as Record<string, unknown>)) {
      if (!Array.isArray(group)) continue;
      for (const f of group) {
        const file = f as Partial<UploadedImageFile> | undefined;
        if (file?.filename && file.path && file.mimetype) {
          files.push(file as UploadedImageFile);
        }
      }
    }
  }
  return files;
};

const writeOptimizedImage = async (file: UploadedImageFile) => {
  const ext = extFromMimeType(file.mimetype) || path.extname(file.filename) || ".jpg";
  const filename = `img-${createFilename(ext)}`;
  const outputPath = path.join(uploadsDir, filename);
  const thumbnailFilename = `${path.parse(filename).name}.webp`;
  const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);

  try {
    const optimized = sharp(file.path)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true });

    if (ext === ".png") {
      await optimized.png({ compressionLevel: 9 }).toFile(outputPath);
    } else if (ext === ".webp") {
      await optimized.webp({ quality: 82 }).toFile(outputPath);
    } else {
      await optimized.jpeg({ quality: 82, mozjpeg: true }).toFile(outputPath);
    }

    await sharp(outputPath)
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(thumbnailPath);

    await fs.promises.unlink(file.path).catch(() => undefined);
    return { filename, outputPath, thumbnailPath };
  } catch (error) {
    await Promise.all([
      fs.promises.unlink(file.path).catch(() => undefined),
      fs.promises.unlink(outputPath).catch(() => undefined),
      fs.promises.unlink(thumbnailPath).catch(() => undefined),
    ]);
    throw error;
  }
};

export const uploadImage: RequestHandler = async (req, res, next) => {
  const files = collectUploadedFiles(req);

  if (files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }

  ensureUploadsDir();
  await fs.promises.mkdir(thumbnailsDir, { recursive: true });
  const created: Array<{ outputPath: string; thumbnailPath: string }> = [];

  try {
    for (const file of files) {
      created.push(await writeOptimizedImage(file));
    }
    res.status(201).json({ urls: created.map((file) => `/uploads/${path.basename(file.outputPath)}`) });
  } catch (error) {
    await Promise.all([
      ...files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)),
      ...created.flatMap((file) => [
        fs.promises.unlink(file.outputPath).catch(() => undefined),
        fs.promises.unlink(file.thumbnailPath).catch(() => undefined),
      ]),
    ]);
    next(error);
  }
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
