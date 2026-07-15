import type { RequestHandler } from "express";
import { calculatePricing, normalizeTimeSlot, normalizeWeather } from "../services/pricing.service";

const toNumberOrNull = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const calculate: RequestHandler = async (req, res, next) => {
  try {
    const body = (req as any).body ?? {};
    const distanceKm = toNumberOrNull(body.distanceKm ?? body.distance_km ?? body.distance);
    const timeSlot = normalizeTimeSlot(body.timeSlot ?? body.time_slot ?? body.period);
    const weather = normalizeWeather(body.weather);
    const urgency = toNumberOrNull(body.urgency ?? body.urgent ?? body.emergency) ?? 0;

    if (distanceKm === null) {
      res.status(400).json({ error: "distanceKm 不合法" });
      return;
    }
    if (!timeSlot) {
      res.status(400).json({ error: "timeSlot 不合法" });
      return;
    }

    const result = await calculatePricing({
      distanceKm,
      timeSlot,
      weather,
      urgency,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
};

