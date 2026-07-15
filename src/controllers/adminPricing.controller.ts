import type { RequestHandler } from "express";
import { applyPricingRecommendation, getRecommend as getRecommendService } from "../services/pricing.service";
import { setAiPricingEnabled } from "../services/systemConfig.service";

const toIntOrNull = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
};

const toBooleanOrNull = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  }
  return null;
};

export const getRecommend: RequestHandler = async (_req, res, next) => {
  try {
    const result = await getRecommendService();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const applyRecommend: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req as any).body ?? {};
    const modelVersion = toIntOrNull(body.model_version ?? body.modelVersion ?? body.version);
    if (!modelVersion) {
      res.status(400).json({ error: "modelVersion 不合法" });
      return;
    }

    const rec = await applyPricingRecommendation({ modelVersion });
    res.status(200).json({ applied: true, recommend: rec });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const switchAiPricing: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req as any).body ?? {};
    const enabled = toBooleanOrNull(body.enabled ?? body.ai_pricing_enabled ?? body.aiPricingEnabled);
    if (enabled === null) {
      res.status(400).json({ error: "enabled 不合法" });
      return;
    }

    await setAiPricingEnabled(enabled);
    res.status(200).json({ ai_pricing_enabled: enabled });
  } catch (err) {
    next(err);
  }
};
