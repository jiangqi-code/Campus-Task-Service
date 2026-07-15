import { Prisma, PrismaClient } from "@prisma/client";
import { calculateDeliveryFee, getAiPricingEnabled, getPricingModelVersion, setPricingModelVersion } from "./systemConfig.service";

const prisma = new PrismaClient();

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object") {
    const maybeDecimal = value as { toNumber?: () => number };
    if (typeof maybeDecimal.toNumber === "function") {
      const n = maybeDecimal.toNumber();
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const normalizeTimeSlot = (input: unknown) => {
  const v = typeof input === "string" ? input.trim() : "";
  if (!v) return null;
  return v;
};

export const normalizeWeather = (input: unknown) => {
  const v = typeof input === "string" ? input.trim() : "";
  if (!v) return null;
  return v.toLowerCase();
};

const getCoeffFromMap = (map: Record<string, number> | null | undefined, key: string) => {
  if (!map) return 1;
  const raw = map[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 1;
  return raw;
};

const computeRecommendedPriceFromRecommendation = (input: {
  distanceKm: number;
  timeSlot: string;
  weather: string | null;
  urgency: number;
  rec: {
    model_version: number;
    base_fee: Prisma.Decimal;
    distance_unit_price: Prisma.Decimal;
    time_coeff_json: unknown;
    weather_coeff_json: unknown;
  };
}) => {
  const timeCoeffMap =
    input.rec.time_coeff_json && typeof input.rec.time_coeff_json === "object"
      ? (input.rec.time_coeff_json as Record<string, number>)
      : null;
  const weatherCoeffMap =
    input.rec.weather_coeff_json && typeof input.rec.weather_coeff_json === "object"
      ? (input.rec.weather_coeff_json as Record<string, number>)
      : null;

  const timeCoeff = getCoeffFromMap(timeCoeffMap, input.timeSlot);
  const weatherCoeff = input.weather ? getCoeffFromMap(weatherCoeffMap, input.weather) : 1;
  const urgencyCoeff = 1 + clamp(input.urgency, 0, 5) * 0.05;

  const base = input.rec.base_fee;
  const distance = input.rec.distance_unit_price.mul(new Prisma.Decimal(input.distanceKm.toFixed(3)));
  const subtotal = base.plus(distance);
  const multiplied = subtotal.mul(new Prisma.Decimal((timeCoeff * weatherCoeff * urgencyCoeff).toFixed(6)));

  return {
    model_version: input.rec.model_version,
    components: {
      base_fee: base.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      distance_fee: distance.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      time_coeff: timeCoeff,
      weather_coeff: weatherCoeff,
      urgency_coeff: urgencyCoeff,
    },
    recommended_price: multiplied.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
};

const computeRecommendedPriceFromLogs = async (input: {
  distanceKm: number;
  timeSlot: string;
  weather: string | null;
  urgency: number;
}) => {
  const now = Date.now();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.pricingLog.findMany({
    where: { created_at: { gte: since }, distance_km: { not: null }, deal_price: { not: null } },
    orderBy: { created_at: "desc" },
    take: 800,
    select: {
      distance_km: true,
      time_slot: true,
      weather: true,
      urgency: true,
      deal_price: true,
    },
  });

  const weights: number[] = [];
  const prices: number[] = [];

  for (const row of rows) {
    const d = toFiniteNumberOrNull(row.distance_km);
    const p = toFiniteNumberOrNull(row.deal_price);
    if (d === null || p === null) continue;

    const distanceDiff = Math.abs(d - input.distanceKm);
    const wDistance = Math.exp(-distanceDiff / 2);
    const wTime = row.time_slot === input.timeSlot ? 1 : 0.85;
    const wWeather =
      input.weather && row.weather ? (String(row.weather).toLowerCase() === input.weather ? 1 : 0.9) : 1;
    const wUrgency = 1 - clamp(Math.abs((row.urgency ?? 0) - input.urgency), 0, 5) * 0.03;
    const w = wDistance * wTime * wWeather * wUrgency;
    if (!Number.isFinite(w) || w <= 0) continue;

    weights.push(w);
    prices.push(p);
  }

  const sumW = weights.reduce((acc, v) => acc + v, 0);
  if (!Number.isFinite(sumW) || sumW <= 0) return null;

  const weighted = prices.reduce((acc, p, idx) => acc + p * weights[idx], 0) / sumW;
  if (!Number.isFinite(weighted) || weighted < 0) return null;

  return {
    sample_size: weights.length,
    recommended_price: new Prisma.Decimal(weighted).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
};

export const calculatePricing = async (input: {
  distanceKm: number;
  timeSlot: string;
  weather: string | null;
  urgency: number;
}) => {
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
    throw new Error("distanceKm 不合法");
  }
  if (typeof input.timeSlot !== "string" || !input.timeSlot.trim()) {
    throw new Error("timeSlot 不合法");
  }
  if (!Number.isFinite(input.urgency) || input.urgency < 0) {
    throw new Error("urgency 不合法");
  }

  const aiEnabled = await getAiPricingEnabled();
  if (!aiEnabled) {
    const fixed = await calculateDeliveryFee({ distanceKm: input.distanceKm, isUrgent: input.urgency > 0 });
    return {
      ai_enabled: false,
      pricing_model_version: null as number | null,
      method: "fixed" as const,
      breakdown: {
        base_fee: fixed.baseFee,
        distance_fee: fixed.distanceFee,
        urgent_fee: fixed.urgentFee,
      },
      recommended_price: fixed.deliveryFee,
    };
  }

  const configuredVersion = await getPricingModelVersion();
  const rec =
    configuredVersion > 0
      ? await prisma.pricingRecommendation.findUnique({ where: { model_version: configuredVersion } })
      : null;
  const fallbackRec =
    rec ??
    (await prisma.pricingRecommendation.findFirst({
      orderBy: { model_version: "desc" },
    }));

  if (fallbackRec) {
    const computed = computeRecommendedPriceFromRecommendation({
      distanceKm: input.distanceKm,
      timeSlot: input.timeSlot,
      weather: input.weather,
      urgency: input.urgency,
      rec: fallbackRec,
    });

    return {
      ai_enabled: true,
      pricing_model_version: computed.model_version,
      method: "recommendation" as const,
      breakdown: computed.components,
      recommended_price: computed.recommended_price,
    };
  }

  const fromLogs = await computeRecommendedPriceFromLogs(input);
  if (fromLogs) {
    return {
      ai_enabled: true,
      pricing_model_version: null as number | null,
      method: "logs" as const,
      breakdown: { sample_size: fromLogs.sample_size },
      recommended_price: fromLogs.recommended_price,
    };
  }

  const fixed = await calculateDeliveryFee({ distanceKm: input.distanceKm, isUrgent: input.urgency > 0 });
  return {
    ai_enabled: true,
    pricing_model_version: null as number | null,
    method: "fixed_fallback" as const,
    breakdown: {
      base_fee: fixed.baseFee,
      distance_fee: fixed.distanceFee,
      urgent_fee: fixed.urgentFee,
    },
    recommended_price: fixed.deliveryFee,
  };
};

const computeOls = (pairs: Array<{ x: number; y: number }>) => {
  if (pairs.length < 2) return null;
  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let varX = 0;
  let covXY = 0;
  for (let i = 0; i < pairs.length; i++) {
    const dx = xs[i] - meanX;
    varX += dx * dx;
    covXY += dx * (ys[i] - meanY);
  }
  if (!Number.isFinite(varX) || varX <= 1e-9) {
    const a = clamp(meanY, 0, Number.POSITIVE_INFINITY);
    return { a, b: 0 };
  }

  const b = covXY / varX;
  const a = meanY - b * meanX;
  return { a: clamp(a, 0, Number.POSITIVE_INFINITY), b: clamp(b, 0, Number.POSITIVE_INFINITY) };
};

export const runDailyPricingAnalysis = async () => {
  const now = Date.now();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.pricingLog.findMany({
    where: { created_at: { gte: since }, distance_km: { not: null }, deal_price: { not: null } },
    orderBy: { created_at: "desc" },
    take: 5000,
    select: {
      distance_km: true,
      time_slot: true,
      weather: true,
      deal_price: true,
    },
  });

  const pairs: Array<{ x: number; y: number }> = [];
  for (const row of rows) {
    const x = toFiniteNumberOrNull(row.distance_km);
    const y = toFiniteNumberOrNull(row.deal_price);
    if (x === null || y === null) continue;
    if (x < 0 || y < 0) continue;
    pairs.push({ x, y });
  }

  const ols = computeOls(pairs);
  if (!ols) return null;

  const timeBucket: Record<string, { sum: number; count: number }> = {};
  const weatherBucket: Record<string, { sum: number; count: number }> = {};

  for (const row of rows) {
    const x = toFiniteNumberOrNull(row.distance_km);
    const y = toFiniteNumberOrNull(row.deal_price);
    if (x === null || y === null) continue;

    const yHat = ols.a + ols.b * x;
    if (!Number.isFinite(yHat) || yHat <= 0) continue;
    const ratio = y / yHat;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;

    const slot = String(row.time_slot ?? "").trim();
    if (slot) {
      timeBucket[slot] ??= { sum: 0, count: 0 };
      timeBucket[slot].sum += ratio;
      timeBucket[slot].count += 1;
    }

    const weather = typeof row.weather === "string" ? row.weather.trim().toLowerCase() : "";
    if (weather) {
      weatherBucket[weather] ??= { sum: 0, count: 0 };
      weatherBucket[weather].sum += ratio;
      weatherBucket[weather].count += 1;
    }
  }

  const timeCoeff: Record<string, number> = {};
  for (const [k, v] of Object.entries(timeBucket)) {
    if (v.count <= 0) continue;
    timeCoeff[k] = clamp(v.sum / v.count, 0.5, 2);
  }

  const weatherCoeff: Record<string, number> = {};
  for (const [k, v] of Object.entries(weatherBucket)) {
    if (v.count <= 0) continue;
    weatherCoeff[k] = clamp(v.sum / v.count, 0.5, 2);
  }

  const currentMax = await prisma.pricingRecommendation.findFirst({
    orderBy: { model_version: "desc" },
    select: { model_version: true },
  });
  const nextVersion = (currentMax?.model_version ?? 0) + 1;

  const created = await prisma.pricingRecommendation.create({
    data: {
      model_version: nextVersion,
      base_fee: new Prisma.Decimal(ols.a).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      distance_unit_price: new Prisma.Decimal(ols.b).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
      time_coeff_json: Object.keys(timeCoeff).length ? timeCoeff : Prisma.DbNull,
      weather_coeff_json: Object.keys(weatherCoeff).length ? weatherCoeff : Prisma.DbNull,
      sample_size: pairs.length,
    },
  });

  return created;
};

export const getLatestPricingRecommendation = async () => {
  return prisma.pricingRecommendation.findFirst({
    orderBy: { model_version: "desc" },
  });
};

export const getRecommend = async () => {
  const [ai_enabled, pricing_model_version, recommend] = await Promise.all([
    getAiPricingEnabled(),
    getPricingModelVersion(),
    getLatestPricingRecommendation(),
  ]);

  return {
    ai_enabled,
    pricing_model_version,
    model_version: recommend?.model_version ?? null,
    base_fee: recommend?.base_fee ?? null,
    distance_unit_price: recommend?.distance_unit_price ?? null,
    time_coeff_json: recommend?.time_coeff_json ?? null,
    weather_coeff_json: recommend?.weather_coeff_json ?? null,
    sample_size: recommend?.sample_size ?? 0,
    created_at: recommend?.created_at ?? null,
  };
};

export const applyPricingRecommendation = async (input: { modelVersion: number }) => {
  if (!Number.isFinite(input.modelVersion) || input.modelVersion <= 0) {
    throw new Error("modelVersion 不合法");
  }
  const rec = await prisma.pricingRecommendation.findUnique({ where: { model_version: input.modelVersion } });
  if (!rec) {
    throw new Error("推荐版本不存在");
  }
  await setPricingModelVersion(input.modelVersion);
  return rec;
};
