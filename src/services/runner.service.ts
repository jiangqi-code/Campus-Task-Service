import { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { type RedisClientType, createClient } from "redis";

export class RunnerError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const prisma = new PrismaClient();

let redisClient: RedisClientType | null = null;
let redisConnecting: Promise<RedisClientType> | null = null;

const getRedisClient = async () => {
  if (redisClient?.isOpen) return redisClient;
  if (redisConnecting) return redisConnecting;

  const client: RedisClientType = createClient(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined);
  client.on("error", () => { });

  redisConnecting = client
    .connect()
    .then(() => {
      redisClient = client;
      return client;
    })
    .finally(() => {
      redisConnecting = null;
    });

  return redisConnecting;
};

const roundRate = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(4));
};

export const getStatistics = async (runnerId: number) => {
  if (!Number.isFinite(runnerId) || runnerId <= 0) {
    throw new RunnerError(400, "runnerId 不合法");
  }

  const [totalOrders, completedOrders, cancelledOrders, onTimeRows] = await prisma.$transaction([
    prisma.order.count({ where: { taker_id: runnerId } }),
    prisma.order.count({ where: { taker_id: runnerId, status: OrderStatus.COMPLETED } }),
    prisma.order.count({ where: { taker_id: runnerId, status: OrderStatus.CANCELLED } }),
    prisma.$queryRaw<Array<{ total: bigint | number }>>(
      Prisma.sql`
        SELECT COUNT(*) AS total
        FROM orders o
        WHERE o.taker_id = ${runnerId}
          AND o.status = ${OrderStatus.COMPLETED}
          AND o.complete_time IS NOT NULL
          AND o.accept_time IS NOT NULL
          AND o.eta_minutes IS NOT NULL
          AND o.complete_time <= DATE_ADD(o.accept_time, INTERVAL o.eta_minutes MINUTE)
      `,
    ),
  ]);

  const onTimeCompleted = Number((onTimeRows[0] as { total?: bigint | number } | undefined)?.total ?? 0);

  let grabAttempts = 0;
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(`stat:runner:grab_attempts:${runnerId}`);
    const n = raw === null ? 0 : Number(raw);
    grabAttempts = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  } catch { }

  const acceptance_rate = grabAttempts > 0 ? roundRate(totalOrders / grabAttempts) : 0;
  const on_time_rate = completedOrders > 0 ? roundRate(onTimeCompleted / completedOrders) : 0;

  return {
    acceptance_rate,
    on_time_rate,
    total_orders: totalOrders,
    completed_orders: completedOrders,
    cancelled_orders: cancelledOrders,
  };
};

