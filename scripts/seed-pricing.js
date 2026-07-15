require("dotenv").config();

const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();

const randInt = (min, max) => {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
};

const randFloat = (min, max) => Math.random() * (max - min) + min;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const computeOls = (pairs) => {
  if (!Array.isArray(pairs) || pairs.length < 2) return null;
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

const main = async () => {
  const seedTag = Date.now();

  const publisher = await prisma.user.create({
    data: {
      student_id: `seed_pub_${seedTag}`,
      phone: `199${randInt(10000000, 99999999)}`,
      nickname: "seed_publisher",
      role: "USER",
    },
    select: { id: true },
  });

  const runner = await prisma.user.create({
    data: {
      student_id: `seed_runner_${seedTag}`,
      phone: `198${randInt(10000000, 99999999)}`,
      nickname: "seed_runner",
      role: "RUNNER",
    },
    select: { id: true },
  });

  const timeSlots = ["00-06", "06-12", "12-18", "18-24"];
  const weathers = ["sunny", "cloudy", "rain", "snow"];

  const timeCoeff = { "00-06": 0.9, "06-12": 1.0, "12-18": 1.05, "18-24": 1.25 };
  const weatherCoeff = { sunny: 1.0, cloudy: 1.02, rain: 1.15, snow: 1.25 };

  const baseFee = 5;
  const perKm = 1.2;

  const count = 240;
  const daysBack = 20;

  for (let i = 0; i < count; i++) {
    const distanceKm = Number(randFloat(0.6, 8.5).toFixed(3));
    const slot = timeSlots[randInt(0, timeSlots.length - 1)];
    const weather = weathers[randInt(0, weathers.length - 1)];
    const urgency = randInt(0, 3);

    const urgencyCoeff = 1 + clamp(urgency, 0, 5) * 0.05;
    const noise = randFloat(-1.2, 1.2);
    const ideal = (baseFee + perKm * distanceKm) * timeCoeff[slot] * weatherCoeff[weather] * urgencyCoeff + noise;
    const deal = Number(clamp(ideal, 3, 9999).toFixed(2));

    const createdAt = new Date(Date.now() - randInt(0, daysBack) * 24 * 60 * 60 * 1000 - randInt(0, 6 * 60 * 60 * 1000));
    const acceptLatencySeconds = randInt(10, 480);
    const acceptTime = new Date(createdAt.getTime() + acceptLatencySeconds * 1000);
    const completeTime = new Date(acceptTime.getTime() + randInt(10, 70) * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          publisher_id: publisher.id,
          pickup_address: `seed_pickup_${seedTag}_${i}`,
          delivery_address: `seed_delivery_${seedTag}_${i}`,
          type: "DELIVERY",
          urgency,
          fee_total: new Prisma.Decimal(deal),
          created_at: createdAt,
          updated_at: createdAt,
        },
        select: { id: true },
      });

      const order = await tx.order.create({
        data: {
          task_id: task.id,
          taker_id: runner.id,
          status: "COMPLETED",
          accept_time: acceptTime,
          complete_time: completeTime,
          final_price: new Prisma.Decimal(deal),
          created_at: createdAt,
          updated_at: completeTime,
        },
        select: { id: true },
      });

      await tx.pricingLog.create({
        data: {
          order_id: order.id,
          task_id: task.id,
          distance_km: new Prisma.Decimal(distanceKm),
          time_slot: slot,
          weather,
          urgency,
          deal_price: new Prisma.Decimal(deal),
          accept_latency_seconds: acceptLatencySeconds,
          ai_enabled: true,
          pricing_model_version: 0,
          created_at: completeTime,
        },
      });

      return { taskId: task.id, orderId: order.id };
    });

    if ((i + 1) % 60 === 0) {
      process.stdout.write(`seeded ${i + 1}/${count} (last order ${result.orderId})\n`);
    }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const logs = await prisma.pricingLog.findMany({
    where: { created_at: { gte: since }, distance_km: { not: null }, deal_price: { not: null } },
    orderBy: { created_at: "desc" },
    take: 5000,
    select: { distance_km: true, deal_price: true, time_slot: true, weather: true },
  });

  const pairs = [];
  for (const row of logs) {
    const x = typeof row.distance_km?.toNumber === "function" ? row.distance_km.toNumber() : Number(row.distance_km);
    const y = typeof row.deal_price?.toNumber === "function" ? row.deal_price.toNumber() : Number(row.deal_price);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) continue;
    pairs.push({ x, y });
  }

  const ols = computeOls(pairs);
  if (!ols) {
    process.stdout.write("analysis skipped: not enough data\n");
    return;
  }

  const timeBucket = {};
  const weatherBucket = {};

  for (const row of logs) {
    const x = typeof row.distance_km?.toNumber === "function" ? row.distance_km.toNumber() : Number(row.distance_km);
    const y = typeof row.deal_price?.toNumber === "function" ? row.deal_price.toNumber() : Number(row.deal_price);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) continue;
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

    const w = typeof row.weather === "string" ? row.weather.trim().toLowerCase() : "";
    if (w) {
      weatherBucket[w] ??= { sum: 0, count: 0 };
      weatherBucket[w].sum += ratio;
      weatherBucket[w].count += 1;
    }
  }

  const timeCoeffJson = {};
  for (const k of Object.keys(timeBucket)) {
    const v = timeBucket[k];
    if (!v || v.count <= 0) continue;
    timeCoeffJson[k] = clamp(v.sum / v.count, 0.5, 2);
  }

  const weatherCoeffJson = {};
  for (const k of Object.keys(weatherBucket)) {
    const v = weatherBucket[k];
    if (!v || v.count <= 0) continue;
    weatherCoeffJson[k] = clamp(v.sum / v.count, 0.5, 2);
  }

  const currentMax = await prisma.pricingRecommendation.findFirst({
    orderBy: { model_version: "desc" },
    select: { model_version: true },
  });
  const nextVersion = (currentMax?.model_version ?? 0) + 1;

  const rec = await prisma.pricingRecommendation.create({
    data: {
      model_version: nextVersion,
      base_fee: new Prisma.Decimal(ols.a).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      distance_unit_price: new Prisma.Decimal(ols.b).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
      time_coeff_json: Object.keys(timeCoeffJson).length ? timeCoeffJson : null,
      weather_coeff_json: Object.keys(weatherCoeffJson).length ? weatherCoeffJson : null,
      sample_size: pairs.length,
    },
    select: { model_version: true, base_fee: true, distance_unit_price: true, sample_size: true },
  });

  process.stdout.write(
    `created recommendation v${rec.model_version}: base_fee=${rec.base_fee.toString()} distance_unit_price=${rec.distance_unit_price.toString()} sample_size=${rec.sample_size}\n`
  );
};

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

