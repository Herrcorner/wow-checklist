import "server-only";

import fs from "fs";
import path from "path";

const DEFAULT_MAX_LRU_ENTRIES = 300;
const GLOBAL_RPS = 5;
const PER_USER_RPS = 2;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const JITTER_MS = 250;
const CLASSIC_NAMESPACE_HINT = "classic";

export type BlizzardFetchOptions = {
  method?: string;
  namespace?: string;
  locale?: string;
  tokenUserId?: string;
  accessToken?: string;
  headers?: Record<string, string>;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

class LruCache<T> {
  private maxEntries: number;
  private map: Map<string, CacheEntry<T>>;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry<T>) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, entry);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey) this.map.delete(oldestKey);
    }
  }
}

const memoryCache = new LruCache<unknown>(DEFAULT_MAX_LRU_ENTRIES);
const persistentCache = new Map<string, CacheEntry<unknown>>();
let persistentLoaded = false;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "blizzard-cache.json");

const globalBucket = createTokenBucket(GLOBAL_RPS);
const userBuckets = new Map<string, ReturnType<typeof createTokenBucket>>();

class BlizzardApiError extends Error {
  status: number;
  endpointUnavailable: boolean;

  constructor(message: string, status: number, endpointUnavailable = false) {
    super(message);
    this.status = status;
    this.endpointUnavailable = endpointUnavailable;
  }
}

export async function getCached<T>(
  url: string,
  ttlSeconds: number,
  options: BlizzardFetchOptions = {},
): Promise<T> {
  const { method = "GET", namespace, locale, tokenUserId, accessToken, headers } =
    options;
  const finalUrl = withQueryParams(url, { namespace, locale });
  const cacheKey = buildCacheKey(method, finalUrl, namespace, locale, tokenUserId);

  const cached = getCacheEntry<T>(cacheKey);
  if (cached) return cached.value;

  await throttle(tokenUserId ?? "global");

  const response = await fetchWithRetry(finalUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    namespace,
  });

  if (!response.ok) {
    const endpointUnavailable =
      (response.status === 403 || response.status === 404) &&
      isClassicEndpoint(finalUrl, namespace);
    if (endpointUnavailable) {
      setCacheEntry(cacheKey, null, ttlSeconds * 2);
    }
    throw new BlizzardApiError(
      `Blizzard API request failed with status ${response.status}`,
      response.status,
      endpointUnavailable,
    );
  }

  const data = (await response.json()) as T;
  const responseTtl = resolveTtl(response.headers, ttlSeconds);
  setCacheEntry(cacheKey, data, responseTtl);
  return data;
}

function getCacheEntry<T>(cacheKey: string): CacheEntry<T> | undefined {
  const now = Date.now();
  const memoryEntry = memoryCache.get(cacheKey) as CacheEntry<T> | undefined;
  if (memoryEntry && memoryEntry.expiresAt > now) return memoryEntry;

  loadPersistentCache();
  const persisted = persistentCache.get(cacheKey) as CacheEntry<T> | undefined;
  if (persisted && persisted.expiresAt > now) {
    memoryCache.set(cacheKey, persisted as CacheEntry<unknown>);
    return persisted;
  }

  if (persisted) {
    persistentCache.delete(cacheKey);
    savePersistentCache();
  }

  return undefined;
}

function setCacheEntry<T>(cacheKey: string, value: T, ttlSeconds: number) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const entry: CacheEntry<T> = { value, expiresAt };
  memoryCache.set(cacheKey, entry as CacheEntry<unknown>);
  persistentCache.set(cacheKey, entry as CacheEntry<unknown>);
  savePersistentCache();
}

function loadPersistentCache() {
  if (persistentLoaded) return;
  persistentLoaded = true;
  if (!fs.existsSync(CACHE_FILE)) return;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<
      string,
      { value: unknown; expiresAt: number }
    >;
    Object.entries(parsed).forEach(([key, entry]) => {
      persistentCache.set(key, entry);
    });
  } catch {
    persistentCache.clear();
  }
}

function savePersistentCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload: Record<string, CacheEntry<unknown>> = {};
  persistentCache.forEach((value, key) => {
    payload[key] = value;
  });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
}

function buildCacheKey(
  method: string,
  url: string,
  namespace?: string,
  locale?: string,
  tokenUserId?: string,
) {
  return [method, url, namespace ?? "", locale ?? "", tokenUserId ?? ""].join(
    "::",
  );
}

function withQueryParams(
  url: string,
  params: { namespace?: string; locale?: string },
) {
  const target = new URL(url);
  if (params.namespace && !target.searchParams.has("namespace")) {
    target.searchParams.set("namespace", params.namespace);
  }
  if (params.locale && !target.searchParams.has("locale")) {
    target.searchParams.set("locale", params.locale);
  }
  return target.toString();
}

function resolveTtl(headers: Headers, defaultTtl: number) {
  const cacheControl = headers.get("cache-control");
  if (!cacheControl) return defaultTtl;
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) {
    const parsed = Number.parseInt(maxAgeMatch[1] ?? "", 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return defaultTtl;
}

function isClassicEndpoint(url: string, namespace?: string) {
  const lowered = url.toLowerCase();
  if (namespace?.toLowerCase().includes(CLASSIC_NAMESPACE_HINT)) return true;
  return lowered.includes("/classic") || lowered.includes("profile-classic");
}

function createTokenBucket(ratePerSecond: number) {
  return {
    capacity: ratePerSecond,
    tokens: ratePerSecond,
    lastRefill: Date.now(),
    refillRate: ratePerSecond,
  };
}

async function throttle(tokenUserId: string) {
  const bucket = getUserBucket(tokenUserId);
  await Promise.all([
    waitForToken(globalBucket),
    waitForToken(bucket),
  ]);
}

function getUserBucket(tokenUserId: string) {
  const existing = userBuckets.get(tokenUserId);
  if (existing) return existing;
  const bucket = createTokenBucket(PER_USER_RPS);
  userBuckets.set(tokenUserId, bucket);
  return bucket;
}

async function waitForToken(bucket: ReturnType<typeof createTokenBucket>) {
  while (true) {
    refillBucket(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      await sleep(Math.random() * JITTER_MS);
      return;
    }
    const missing = 1 - bucket.tokens;
    const waitMs = (missing / bucket.refillRate) * 1000 + Math.random() * JITTER_MS;
    await sleep(waitMs);
  }
}

function refillBucket(bucket: ReturnType<typeof createTokenBucket>) {
  const now = Date.now();
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  if (elapsedSeconds <= 0) return;
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + elapsedSeconds * bucket.refillRate,
  );
  bucket.lastRefill = now;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & { namespace?: string },
) {
  let attempt = 0;
  let backoff = BACKOFF_BASE_MS;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    const response = await fetch(url, options);

    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) return response;
      await sleep(withJitter(backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }

    if (response.status >= 500 && response.status <= 599) {
      if (attempt >= MAX_RETRIES) return response;
      await sleep(withJitter(backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      continue;
    }

    if (
      (response.status === 403 || response.status === 404) &&
      isClassicEndpoint(url, options.namespace)
    ) {
      return response;
    }

    return response;
  }

  return fetch(url, options);
}

function withJitter(ms: number) {
  return ms + Math.random() * JITTER_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { BlizzardApiError };
