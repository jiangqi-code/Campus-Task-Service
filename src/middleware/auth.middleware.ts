import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

console.log("[auth.middleware] JWT_SECRET exists:", Boolean(process.env.JWT_SECRET));

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: Role;
      };
    }
  }
}

type AuthTokenPayload = {
  userId: number;
  role: Role;
};

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

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  const token = parseBearerToken(header);

  if (!token) {
    console.log("[auth.middleware] Unauthorized: missing or invalid Authorization header", {
      authorizationHeaderPresent: Boolean(header),
      authorizationHeaderValue: header,
    });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.log("[auth.middleware] Unauthorized: JWT_SECRET is missing in process.env");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret);
    if (!decoded || typeof decoded !== "object") {
      console.log("[auth.middleware] Unauthorized: decoded token is not an object", {
        decodedType: typeof decoded,
      });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = decoded as Partial<AuthTokenPayload>;
    if (typeof payload.userId !== "number" || !isRole(payload.role)) {
      console.log("[auth.middleware] Unauthorized: invalid token payload", {
        userIdType: typeof payload.userId,
        role: payload.role,
      });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.user = { id: payload.userId, role: payload.role };
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "UnknownError";
    console.log("[auth.middleware] Unauthorized: jwt.verify failed", { name, message });
    res.status(401).json({ error: "Unauthorized" });
  }
};
