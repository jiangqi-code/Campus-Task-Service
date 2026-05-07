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

    const result = await authService.login({
      account: account ?? "",
      password: password ?? "",
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
