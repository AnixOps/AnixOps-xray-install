import { Redis } from "ioredis";
import { env } from "../config/runtime-env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Cache helpers
export async function getCache<T>(key: string): Promise<T | null> {
  const value = await redis.get(key);
  return value ? JSON.parse(value) : null;
}

export async function setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.setex(key, ttlSeconds, serialized);
  } else {
    await redis.set(key, serialized);
  }
}

export async function deleteCache(key: string): Promise<void> {
  await redis.del(key);
}
