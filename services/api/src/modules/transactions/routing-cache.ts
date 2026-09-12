const routingDependencyCache = new Map<string, { value: unknown; expiresAt: number }>();

export const ROUTING_CACHE_TTL_MS = 300_000;
export const SHORT_ROUTING_CACHE_TTL_MS = 30_000;

export async function getCachedRoutingDependency<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = routingDependencyCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await loader();
  routingDependencyCache.set(key, {
    value,
    expiresAt: now + ttlMs
  });

  return value;
}

export function invalidateRoutingDependency(key?: string) {
  if (key) {
    routingDependencyCache.delete(key);
  } else {
    routingDependencyCache.clear();
  }
}

export function invalidateFeeRuleRoutingCache(organizationId?: string) {
  if (organizationId) {
    routingDependencyCache.delete(`fee-rule:${organizationId}`);
  } else {
    for (const key of routingDependencyCache.keys()) {
      if (key.startsWith("fee-rule:")) {
        routingDependencyCache.delete(key);
      }
    }
  }
}
