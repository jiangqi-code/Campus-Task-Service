import type { RequestHandler } from "express";
import { Role } from "@prisma/client";

const toRole = (value: unknown): Role | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  const all = Object.values(Role) as string[];
  if (all.includes(normalized)) return normalized as Role;
  return null;
};

export const requireRole = (role: Role | string | Array<Role | string>): RequestHandler => {
  const roles = (Array.isArray(role) ? role : [role])
    .map(toRole)
    .filter((v): v is Role => Boolean(v));

  return (req, res, next) => {
    const user = (req as any).user as { role?: unknown } | undefined;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userRole = toRole(user.role);
    console.log("requireRole", { userRole: user.role, requiredRole: role });

    if (!userRole || !roles.includes(userRole)) {
      res.status(403).json({ error: "无权限" });
      return;
    }

    next();
  };
};
