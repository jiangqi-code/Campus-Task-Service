import type { RequestHandler } from "express";
import { AuthError, AuthService } from "../services/auth.service";

const authService = new AuthService();

export const register: RequestHandler = async (req, res, next) => {
  try {
    const { student_id, phone, password, nickname } = req.body as Partial<{
      student_id: string;
      phone: string;
      password: string;
      nickname: string;
    }>;

    const result = await authService.register({
      student_id: student_id ?? "",
      phone: phone ?? "",
      password: password ?? "",
      nickname: nickname ?? "",
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const login: RequestHandler = async (req, res, next) => {
  try {
    const { account, password } = req.body as Partial<{
      account: string;
      password: string;
    }>;

    const { token, user } = await authService.login({
      account: account ?? "",
      password: password ?? "",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? "",
    });

    res.status(200).json({ token, user });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const me: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const meData = await authService.me(user.id);
    res.status(200).json({ user: meData });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const submitAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { real_name, card_image_url } = req.body as Partial<{
      real_name: string;
      card_image_url: string;
    }>;

    const result = await authService.submitAuth({
      userId: user.id,
      real_name: real_name ?? "",
      card_image_url: card_image_url ?? "",
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const getAuthList: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await authService.getAuthList({
      adminId: user.id,
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const auditAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const authId = Number.parseInt(String(req.params.authId ?? ""), 10);
    const { action, reason } = req.body as Partial<{ action: unknown; reason: unknown }>;

    const result = await authService.auditAuth({
      adminId: user.id,
      authId,
      action,
      reason,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};
