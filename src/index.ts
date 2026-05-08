import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import fs from "fs";
import { createServer } from "http";
import path from "path";
import type { ErrorRequestHandler, RequestHandler } from "express-serve-static-core";
import { PrismaClient } from "@prisma/client";
import authRouter, { userAuthRouter } from "./routes/auth.routes";
import taskRouter from "./routes/task.routes";
import orderRouter from "./routes/order.routes";
import reviewRouter from "./routes/review.routes";
import refundRouter from "./routes/refund.routes";
import reportRouter from "./routes/report.routes";
import contactRouter from "./routes/contact.routes";
import complaintRouter from "./routes/complaint.routes";
import adminRouter from "./routes/admin.routes";
import withdrawRouter from "./routes/withdraw.routes";
import uploadRouter from "./routes/upload.routes";
import userRouter from "./routes/user.routes";
import walletRouter from "./routes/wallet.routes";
import earningRouter from "./routes/earning.routes";
import runnerRouter from "./routes/runner.routes";
import { websocketService } from "./services/websocket.service";
import { timeoutService } from "./services/timeout.service";
import { scheduledTaskService } from "./services/scheduledTask.service";

const prisma = new PrismaClient();

const app = express();
const port = 3000;

app.use(express.json());

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

const healthHandler: RequestHandler = (_req, res) => {
  res.status(200).json({ status: "ok" });
};

const isPromiseLike = (value: unknown): value is Promise<unknown> => {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function" &&
    typeof (value as { catch?: unknown }).catch === "function"
  );
};

const layerModule: any = require("express/lib/router/layer");
const Layer: any = layerModule?.default ?? layerModule;
if (Layer?.prototype) {
  Layer.prototype.handle_request = function handle_request(req: any, res: any, next: any) {
    const fn = this?.handle;
    if (typeof fn !== "function") return next();
    if (fn.length > 3) return next();
    try {
      const ret = fn(req, res, next);
      if (isPromiseLike(ret)) ret.catch(next);
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype.handle_error = function handle_error(err: any, req: any, res: any, next: any) {
    const fn = this?.handle;
    if (typeof fn !== "function") return next(err);
    if (fn.length !== 4) return next(err);
    try {
      const ret = fn(err, req, res, next);
      if (isPromiseLike(ret)) ret.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

const notFoundHandler: RequestHandler = (req, _res, next) => {
  const err = new Error("Not Found");
  (err as any).statusCode = 404;
  (err as any).status = 404;
  (err as any).url = req.originalUrl ?? req.url ?? "";
  next(err);
};

const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const error_message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? null : null;
  const user_id = req.user?.id ?? null;
  const status =
    typeof (err as any)?.statusCode === "number"
      ? (err as any).statusCode
      : typeof (err as any)?.status === "number"
        ? (err as any).status
        : 500;

  void prisma.errorLog
    .create({
      data: {
        error_message,
        stack,
        url: req.originalUrl ?? req.url ?? "",
        method: req.method ?? "",
        ip: req.ip ?? "",
        user_id,
      },
    })
    .catch(() => null);

  res.status(status).json({
    error: error_message || (status === 404 ? "Not Found" : "Internal Server Error"),
  });
};

app.get("/health", healthHandler);

app.use("/api/auth", authRouter);
app.use("/api/task", taskRouter);
app.use("/api/order", orderRouter);
app.use("/api/order", reviewRouter);
app.use("/api/order", refundRouter);
app.use("/api/order", reportRouter);
app.use("/api/order", contactRouter);
app.use("/api/order", complaintRouter);
app.use("/api/admin", adminRouter);
app.use("/api/withdraw", withdrawRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/user", userRouter);
app.use("/api/user", userAuthRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/earning", earningRouter);
app.use("/api/runner", runnerRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
websocketService.start(server);
if (process.env.NODE_ENV !== "test") {
  timeoutService.start();
  scheduledTaskService.start();
}

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
