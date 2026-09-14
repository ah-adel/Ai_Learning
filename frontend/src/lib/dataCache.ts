type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const pendingLoads = new Map<string, Promise<unknown>>();

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

  const pendingLoad = pendingLoads.get(key);
  if (pendingLoad) {
    return pendingLoad as Promise<T>;
  }

  const nextLoad = Promise.resolve(loader())
    .then((freshValue) => {
      cache.set(key, {
        value: freshValue,
        expiresAt: Date.now() + ttlMs,
      });
      return freshValue;
    })
    .finally(() => {
      if (pendingLoads.get(key) === nextLoad) {
        pendingLoads.delete(key);
      }
    });

  pendingLoads.set(key, nextLoad);

  return nextLoad;
}

export function invalidateCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    pendingLoads.clear();
    return;
  }

  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      pendingLoads.delete(key);
    }
  }
}

export function invalidateStudentEnrollmentCache(studentId?: string) {
  if (studentId) {
    invalidateCache(`student-enrolled-courses:${studentId}`);
    return;
  }

  invalidateCache('student-enrolled-courses:');
}

export function invalidateInstructorCourseCache(instructorId?: string) {
  if (instructorId) {
    invalidateCache(`instructor-courses:${instructorId}`);
  }

  invalidateCache('instructor-courses:');
  invalidateCache('published-courses');
}
