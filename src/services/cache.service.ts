import NodeCache from 'node-cache';

const cache = new NodeCache({
  stdTTL: 120, // 2 minutes default TTL
  checkperiod: 60,
});

export const cacheService = {
  get<T>(key: string): T | undefined {
    return cache.get<T>(key);
  },

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (ttl !== undefined) {
      return cache.set(key, value, ttl);
    }
    return cache.set(key, value);
  },

  del(key: string): number {
    return cache.del(key);
  },

  flush(): void {
    cache.flushAll();
  },
};
