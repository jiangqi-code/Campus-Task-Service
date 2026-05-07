import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import fs from "fs";
import { createServer } from "http";
import path from "path";
import type { ErrorRequestHandler, RequestHandler } from "express-serve-static-core";
import authRouter, { userAuthRouter } from "./routes/auth.routes";
import taskRouter from "./routes/task.routes";
import orderRouter from "./routes/order.routes";
import reviewRouter from "./routes/review.routes";
import refundRouter from "./routes/refund.routes";
import adminRouter from "./routes/admin.routes";
import withdrawRouter from "./routes/withdraw.routes";
import uploadRouter from "./routes/upload.routes";
import userRouter from "./routes/user.routes";
import walletRouter from "./routes/wallet.routes";
import earningRouter from "./routes/earning.routes";
import { websocketService } from "./services/websocket.service";
import { timeoutService } from "./services/timeout.service";
import { scheduledTaskService } from "./services/scheduledTask.service";

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

const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "Internal Server Error";
  res.status(500).json({ error: message });
};

app.get("/health", healthHandler);

app.use("/api/auth", authRouter);
app.use("/api/task", taskRouter);
app.use("/api/order", orderRouter);
app.use("/api/order", reviewRouter);
app.use("/api/order", refundRouter);
app.use("/api/admin", adminRouter);
app.use("/api/withdraw", withdrawRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/user", userRouter);
app.use("/api/user", userAuthRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/earning", earningRouter);

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
