import type { RequestHandler } from "express";
import { AuthError, AuthService } from "../services/auth.service";

const authService = new AuthService();

export const sendCode: RequestHandler = async (req, res, next) => {
  try {
    const result = authService.sendVerificationCode(String(req.body?.phone ?? ''));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) return void res.status(err.status).json({ error: err.message });
    next(err);
  }
};

export const verifyCode: RequestHandler = async (req, res, next) => {
  try {
    const result = authService.verifyVerificationCode(
      String(req.body?.phone ?? ''),
      String(req.body?.code ?? req.body?.verification_code ?? ''),
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) return void res.status(err.status).json({ error: err.message });
    next(err);
  }
};

export const register: RequestHandler = async (req, res, next) => {
  try {
    const { student_id, phone, password, nickname, birth_date, id_card } = req.body as Partial<{
      student_id: string;
      phone: string;
      password: string;
      nickname: string;
      birth_date: string;
      id_card: string;
    }>;

    const result = await authService.register({
      student_id: student_id ?? "",
      phone: phone ?? "",
      password: password ?? "",
      nickname: nickname ?? "",
      birth_date,
      id_card,
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

    const { real_name, student_id, phone, id_card, dormitory, reason, card_image_url } = req.body as Partial<{
      real_name: string;
      student_id: string;
      phone: string;
      id_card: string;
      dormitory: string;
      reason: string;
      card_image_url: string;
    }>;

    const result = await authService.submitAuth({
      userId: user.id,
      real_name: real_name ?? "",
      student_id,
      phone,
      id_card,
      dormitory,
      reason,
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

export const authStatus: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await authService.getAuthStatus(user.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const applyRunner: RequestHandler = async (req, res, next) => {
  return submitAuth(req, res, next);
};

export const applyStatus: RequestHandler = async (req, res, next) => {
  return authStatus(req, res, next);
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
