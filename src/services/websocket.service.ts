import type { Server as HttpServer } from "http";
import { PrismaClient, Role } from "@prisma/client";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";

type AuthTokenPayload = {
  userId: number;
  role: Role;
};

type WsUser = {
  id: number;
  role: Role;
};

const prisma = new PrismaClient();

const parseBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;

  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  if (!token) return null;

  return token;
};

const isRole = (value: unknown): value is Role => {
  if (typeof value !== "string") return false;
  return (Object.values(Role) as string[]).includes(value);
};

const toInt = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i <= 0) return null;
  return i;
};

export class WebsocketService {
  private io: Server | null = null;

  start(httpServer: HttpServer) {
    if (this.io) return this.io;

    const origin = process.env.WS_CORS_ORIGIN ?? "*";
    const path = process.env.WS_PATH ?? "/socket.io";

    const io = new Server(httpServer, {
      path,
      cors: {
        origin,
        credentials: true,
      },
    });

    io.use((socket, next) => {
      const tokenFromAuth = socket.handshake.auth?.token;
      const tokenFromHeader = parseBearerToken(socket.handshake.headers.authorization);
      const token = (typeof tokenFromAuth === "string" && tokenFromAuth.trim() ? tokenFromAuth.trim() : null) ?? tokenFromHeader;

      if (!token) {
        next(new Error("Unauthorized"));
        return;
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        next(new Error("Unauthorized"));
        return;
      }

      try {
        const decoded = jwt.verify(token, secret);
        if (!decoded || typeof decoded !== "object") {
          next(new Error("Unauthorized"));
          return;
        }

        const payload = decoded as Partial<AuthTokenPayload>;
        if (typeof payload.userId !== "number" || !isRole(payload.role)) {
          next(new Error("Unauthorized"));
          return;
        }

        socket.data.user = { id: payload.userId, role: payload.role } satisfies WsUser;
        next();
      } catch {
        next(new Error("Unauthorized"));
      }
    });

    io.on("connection", (socket: Socket) => {
      const user = socket.data.user as WsUser | undefined;
      if (!user) {
        socket.disconnect(true);
        return;
      }

      socket.join(`user:${user.id}`);

      socket.on("order:join", async (payload: unknown, ack?: (res: unknown) => void) => {
        const orderId = toInt((payload as { orderId?: unknown } | null | undefined)?.orderId);
        if (!orderId) {
          ack?.({ ok: false, error: "orderId 不合法" });
          return;
        }

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            taker_id: true,
            task: { select: { publisher_id: true } },
          },
        });
        if (!order) {
          ack?.({ ok: false, error: "订单不存在" });
          return;
        }

        const publisherId = order.task.publisher_id;
        const takerId = order.taker_id;
        const allowed = user.id === publisherId || (typeof takerId === "number" && user.id === takerId);
        if (!allowed) {
          ack?.({ ok: false, error: "无权限" });
          return;
        }

        socket.join(`order:${orderId}`);
        ack?.({ ok: true, orderId });
      });

      socket.on("order:leave", (payload: unknown, ack?: (res: unknown) => void) => {
        const orderId = toInt((payload as { orderId?: unknown } | null | undefined)?.orderId);
        if (!orderId) {
          ack?.({ ok: false, error: "orderId 不合法" });
          return;
        }

        socket.leave(`order:${orderId}`);
        ack?.({ ok: true, orderId });
      });

      socket.on("runner:location:update", async (payload: unknown, ack?: (res: unknown) => void) => {
        const body = payload as Partial<{ orderId: unknown; lat: unknown; lng: unknown; at: unknown }>;
        const orderId = toInt(body?.orderId);
        const lat = typeof body?.lat === "number" ? body.lat : Number(body?.lat);
        const lng = typeof body?.lng === "number" ? body.lng : Number(body?.lng);

        if (!orderId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          ack?.({ ok: false, error: "参数不合法" });
          return;
        }

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            taker_id: true,
            task: { select: { publisher_id: true } },
          },
        });
        if (!order) {
          ack?.({ ok: false, error: "订单不存在" });
          return;
        }

        if (order.taker_id !== user.id) {
          ack?.({ ok: false, error: "无权限" });
          return;
        }

        const at =
          typeof body.at === "string" && body.at.trim()
            ? body.at.trim()
            : new Date().toISOString();

        io.to(`order:${orderId}`).emit("runner:location", {
          orderId,
          takerId: user.id,
          lat,
          lng,
          at,
        });
        io.to(`user:${order.task.publisher_id}`).emit("runner:location", {
          orderId,
          takerId: user.id,
          lat,
          lng,
          at,
        });

        ack?.({ ok: true, orderId });
      });
    });

    this.io = io;
    return io;
  }

  pushToUser(userId: number, event: string, payload: unknown) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new Error("Invalid userId");
    }
    if (typeof event !== "string" || !event.trim()) {
      throw new Error("Invalid event");
    }
    const io = this.getIO();
    io.to(`user:${Math.trunc(userId)}`).emit(event.trim(), payload);
  }

  pushToOrder(orderId: number, event: string, payload: unknown) {
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw new Error("Invalid orderId");
    }
    if (typeof event !== "string" || !event.trim()) {
      throw new Error("Invalid event");
    }
    const io = this.getIO();
    io.to(`order:${Math.trunc(orderId)}`).emit(event.trim(), payload);
  }

  getIO() {
    if (!this.io) {
      throw new Error("WebSocket service not started");
    }
    return this.io;
  }
}

export const websocketService = new WebsocketService();
