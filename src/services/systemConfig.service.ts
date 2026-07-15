import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const deliveryPricingDefaults = [
  { key: "base_delivery_fee", value: "5" },
  { key: "distance_price_per_km", value: "1" },
  { key: "urgent_fee", value: "3" },
] as const;

const aiPricingDefaults = [
  { key: "ai_pricing_enabled", value: "false" },
  { key: "pricing_model_version", value: "0" },
] as const;

const amapSystemConfigKeys = [
  "amap_key",
  "amap_web_api_key",
  "gaode_key",
  "gaode_web_api_key",
  "map_key",
] as const;

const amapEnvKeys = [
  "AMAP_WEB_KEY",        // 添加这一行
  "AMAP_KEY",
  "AMAP_WEB_API_KEY",
  "GAODE_KEY",
  "GAODE_WEB_API_KEY",
  "MAP_KEY",
] as const;

export type DeliveryPricingConfig = {
  base_delivery_fee: number;
  distance_price_per_km: number;
  urgent_fee: number;
};

const ensureDeliveryPricingDefaults = async () => {
  const existing = await prisma.systemConfig.findMany({
    where: { key: { in: deliveryPricingDefaults.map((item) => item.key) as string[] } },
    select: { key: true },
  });

  const existingKeys = new Set(existing.map((item) => item.key));
  const missing = deliveryPricingDefaults.filter((item) => !existingKeys.has(item.key));
  if (!missing.length) return;

  await prisma.systemConfig.createMany({
    data: missing.map((item) => ({ key: item.key, value: item.value })),
    skipDuplicates: true,
  });
};

const ensureAiPricingDefaults = async () => {
  const existing = await prisma.systemConfig.findMany({
    where: { key: { in: aiPricingDefaults.map((item) => item.key) as string[] } },
    select: { key: true },
  });

  const existingKeys = new Set(existing.map((item) => item.key));
  const missing = aiPricingDefaults.filter((item) => !existingKeys.has(item.key));
  if (!missing.length) return;

  await prisma.systemConfig.createMany({
    data: missing.map((item) => ({ key: item.key, value: item.value })),
    skipDuplicates: true,
  });
};

const parseNonNegativeNumber = (key: string, value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`system_config.${key} 配置不合法`);
  }
  return parsed;
};

const parseBoolean = (key: string, value: string) => {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(`system_config.${key} 配置不合法`);
};

export const getDeliveryPricingConfig = async (): Promise<DeliveryPricingConfig> => {
  await ensureDeliveryPricingDefaults();

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: deliveryPricingDefaults.map((item) => item.key) as string[] } },
    select: { key: true, value: true },
  });

  const valueMap = new Map<string, string>(rows.map((item) => [item.key, item.value]));

  const base_delivery_fee = parseNonNegativeNumber(
    "base_delivery_fee",
    valueMap.get("base_delivery_fee") ?? deliveryPricingDefaults[0].value,
  );
  const distance_price_per_km = parseNonNegativeNumber(
    "distance_price_per_km",
    valueMap.get("distance_price_per_km") ?? deliveryPricingDefaults[1].value,
  );
  const urgent_fee = parseNonNegativeNumber(
    "urgent_fee",
    valueMap.get("urgent_fee") ?? deliveryPricingDefaults[2].value,
  );

  return {
    base_delivery_fee,
    distance_price_per_km,
    urgent_fee,
  };
};

export const getAiPricingEnabled = async () => {
  await ensureAiPricingDefaults();
  const row = await prisma.systemConfig.findUnique({
    where: { key: "ai_pricing_enabled" },
    select: { value: true },
  });
  return parseBoolean("ai_pricing_enabled", row?.value ?? aiPricingDefaults[0].value);
};

export const setAiPricingEnabled = async (enabled: boolean) => {
  await ensureAiPricingDefaults();
  await prisma.systemConfig.upsert({
    where: { key: "ai_pricing_enabled" },
    update: { value: enabled ? "true" : "false" },
    create: { key: "ai_pricing_enabled", value: enabled ? "true" : "false" },
  });
};

export const getPricingModelVersion = async () => {
  await ensureAiPricingDefaults();
  const row = await prisma.systemConfig.findUnique({
    where: { key: "pricing_model_version" },
    select: { value: true },
  });
  const n = Number.parseInt(String(row?.value ?? aiPricingDefaults[1].value), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("system_config.pricing_model_version 配置不合法");
  }
  return Math.trunc(n);
};

export const setPricingModelVersion = async (version: number) => {
  await ensureAiPricingDefaults();
  if (!Number.isFinite(version) || version < 0) {
    throw new Error("pricing_model_version 不合法");
  }
  await prisma.systemConfig.upsert({
    where: { key: "pricing_model_version" },
    update: { value: String(Math.trunc(version)) },
    create: { key: "pricing_model_version", value: String(Math.trunc(version)) },
  });
};

export const calculateDeliveryFee = async (input: {
  distanceKm: number;
  isUrgent: boolean;
}) => {
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
    throw new Error("distanceKm 不合法");
  }

  const config = await getDeliveryPricingConfig();
  const distanceKm = new Prisma.Decimal(input.distanceKm.toFixed(3));

  const baseFee = new Prisma.Decimal(config.base_delivery_fee);
  const distanceUnitPrice = new Prisma.Decimal(config.distance_price_per_km);
  const urgentFee = input.isUrgent ? new Prisma.Decimal(config.urgent_fee) : new Prisma.Decimal(0);
  const distanceFee = distanceUnitPrice.mul(distanceKm);
  const deliveryFee = baseFee.plus(distanceFee).plus(urgentFee).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );

  return {
    config,
    baseFee: baseFee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    distanceFee: distanceFee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    urgentFee: urgentFee.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    deliveryFee,
  };
};

export const resolveAmapKey = async () => {
  for (const envKey of amapEnvKeys) {
    const value = process.env[envKey];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: amapSystemConfigKeys as unknown as string[] } },
    orderBy: { key: "asc" },
    select: { key: true, value: true },
  });

  for (const row of rows) {
    if (typeof row.value === "string" && row.value.trim()) {
      return row.value.trim();
    }
  }

  throw new Error("未配置高德地图 key");
};
