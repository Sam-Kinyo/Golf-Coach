import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

let client: SecretManagerServiceClient | null = null;
const cache = new Map<string, CacheEntry>();

function getClient(): SecretManagerServiceClient {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

export async function getSecret(name: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && hit.expiresAt > now) return hit.value;

  const [version] = await getClient().accessSecretVersion({ name });
  const payload = version.payload?.data;
  if (!payload) throw new Error(`Secret ${name} has no payload`);
  const value = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');

  cache.set(name, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export function clearSecretCache(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}
