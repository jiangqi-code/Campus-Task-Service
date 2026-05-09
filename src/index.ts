import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import fs from "fs";
import { createServer } from "http";
import cors from 'cors';
import path from "path";
import type { ErrorRequestHandler, RequestHandler } from "express-serve-static-core";
// @ts-ignore  // 忽略缺少类型声明的报错
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
import swaggerUi from "swagger-ui-express";

const prisma = new PrismaClient();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true
}));

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

const getMountPathFromRegexp = (regexp: any): string => {
  if (!regexp) return "";
  if (regexp.fast_slash) return "";
  const source = typeof regexp.source === "string" ? regexp.source : String(regexp);
  if (!source || source === "^\\/?$") return "";

  let s = source;
  s = s.replace(/^\^/, "");
  s = s.replace(/\\\/\?\(\?=\\\/\|\$\)$/, "");
  s = s.replace(/\(\?=\\\/\|\$\)$/, "");
  s = s.replace(/\\\/\?\$$/, "");
  s = s.replace(/\$$/, "");
  s = s.replace(/\\\//g, "/");
  s = s.replace(/\\(.)/g, "$1");
  s = s.replace(/\/+$/, "");
  if (!s.startsWith("/")) s = `/${s}`;
  return s === "/" ? "" : s;
};

type ScannedRoute = { path: string; methods: string[] };

const scanExpressRoutes = (appLike: any): ScannedRoute[] => {
  const routes: ScannedRoute[] = [];
  const processStack = (stack: any[], basePath: string) => {
    if (!Array.isArray(stack)) return;
    stack.forEach((layer) => {
      if (layer?.route?.path) {
        const routePath = String(layer.route.path);
        const fullPath = `${basePath}${routePath}`.replace(/\/+/g, "/");
        const methods = Object.keys(layer.route.methods ?? {})
          .filter((m) => (layer.route.methods ?? {})[m])
          .map((m) => m.toUpperCase());
        if (methods.length > 0) routes.push({ path: fullPath, methods });
        return;
      }

      const nestedStack = layer?.handle?.stack ?? layer?.handle?._router?.stack;
      if (Array.isArray(nestedStack)) {
        const mountPath = getMountPathFromRegexp(layer?.regexp);
        processStack(nestedStack, `${basePath}${mountPath}`.replace(/\/+/g, "/"));
      }
    });
  };

  const rootStack = appLike?._router?.stack ?? appLike?.router?.stack ?? [];
  processStack(rootStack, "");
  return routes;
};

const toSwaggerPath = (expressPath: string): string => {
  return expressPath.replace(/:([^/]+)/g, "{$1}");
};

const buildOpenApiSpec = (routes: ScannedRoute[]) => {
  const paths: Record<string, any> = {};

  routes.forEach((route) => {
    const swaggerPath = toSwaggerPath(route.path);
    paths[swaggerPath] ??= {};

    const pathSegments = route.path.split("/").filter((seg) => seg && !seg.startsWith(":"));
    const meaningfulSegments = pathSegments.filter(
      (seg) => !["api", "apl", "v1", "v2", "v3", "v4", "v5"].includes(seg.toLowerCase())
    );
    const tag = meaningfulSegments[0] ?? "default";

    route.methods.forEach((method) => {
      const operation: any = {
        summary: `${method} ${route.path}`,
        tags: [tag],
        responses: { 200: { description: "Success" } },
      };

      if (["POST", "PUT", "PATCH"].includes(method)) {
        operation.requestBody = {
          content: {
            "application/json": { schema: { type: "object", properties: {} } },
          },
        };
      }

      const paramMatches = route.path.match(/:([^/]+)/g);
      if (paramMatches) {
        operation.parameters = paramMatches.map((p) => ({
          name: p.slice(1),
          in: "path",
          required: true,
          schema: { type: "string" },
        }));
      }

      paths[swaggerPath][method.toLowerCase()] = operation;
    });
  });

  return {
    openapi: "3.0.0",
    info: {
      title: "校园跑腿系统 API",
      description: "校园跑腿系统后端接口文档",
      version: "1.0.0",
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  };
};

const swaggerRoutes = scanExpressRoutes(app);
const swaggerSpec = buildOpenApiSpec(swaggerRoutes);

app.get("/docs-json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
