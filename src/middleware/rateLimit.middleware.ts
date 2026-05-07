import type { RequestHandler } from "express";
import { type RedisClientType, createClient } from "redis";

let redisClient: RedisClientType | null = null;
let redisConnecting: Promise<RedisClientType> | null = null;

const getRedisClient = async () => {
  if (redisClient?.isOpen) return redisClient;
  if (redisConnecting) return redisConnecting;

  const client: RedisClientType = createClient(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined);
  client.on("error", () => {});

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

const incrWithExpire = async (params: { key: string; windowSeconds: number }) => {
  const redis = await getRedisClient();
  const result = (await redis.eval(
    `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
    `,
    {
      keys: [params.key],
      arguments: [String(params.windowSeconds)],
    },
  )) as unknown;

  const arr = Array.isArray(result) ? result : [];
  const current = typeof arr[0] === "number" ? arr[0] : Number(arr[0]);
  const ttl = typeof arr[1] === "number" ? arr[1] : Number(arr[1]);
  return {
    current: Number.isFinite(current) ? current : 0,
    ttlSeconds: Number.isFinite(ttl) ? ttl : -1,
  };
};

const requireUserId = (req: Express.Request) => {
  const userId = req.user?.id;
  return typeof userId === "number" && Number.isFinite(userId) && userId > 0 ? userId : null;
};

export const limitTaskPublish: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const redis = await getRedisClient();
    const banKey = `ban:task:publish:user:${userId}`;
    const banned = await redis.exists(banKey);
    if (banned) {
      res.status(429).json({ error: "发布任务已被限制，请稍后再试" });
      return;
    }

    const key = `rl:task:publish:user:${userId}`;
    const { current } = await incrWithExpire({ key, windowSeconds: 300 });
    if (current > 3) {
      res.status(429).json({ error: "5分钟内最多发布3个任务" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};

export const limitOrderCancel: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const key = `rl:order:cancel:user:${userId}`;
    const { current } = await incrWithExpire({ key, windowSeconds: 3600 });
    if (current > 2) {
      const redis = await getRedisClient();
      const banKey = `ban:task:publish:user:${userId}`;
      await redis.set(banKey, String(Date.now()), { EX: 1800 });
      res.status(429).json({ error: "1小时内最多取消2个订单，已限制发布任务30分钟" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};

export const antiBrushAcceptTask: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const redis = await getRedisClient();
    const key = `rl:order:accept:user:${userId}`;
    const ok = await redis.set(key, String(Date.now()), { NX: true, EX: 3 });
    if (!ok) {
      res.status(429).json({ error: "操作过于频繁，请稍后再试" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};
