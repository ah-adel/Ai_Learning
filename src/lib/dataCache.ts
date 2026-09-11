type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function getCachedData<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export async function loadCachedData<T>(
  key: string,
  loader: () => Promise<T> | T,
  ttlMs = 30_000,
): Promise<T> {
  const cachedValue = getCachedData<T>(key);
  if (cachedValue !== null) {
    return cachedValue;
  }

  const freshValue = await loader();
  cache.set(key, {
    value: freshValue,
    expiresAt: Date.now() + ttlMs,
  });

  return freshValue;
}

export function invalidateCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    return;
  }

  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
