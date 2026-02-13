/**
 * Credential synchronization to sandboxes
 */
import { getConvex } from "../clients/index.ts";
import { api } from "../../convex/_generated/api.js";
import { Config } from "../config/index.ts";

// Track which sandboxes have had credentials synced this gateway session
const syncedSandboxes = new Set<string>();

/**
 * Sync credentials from Convex to a running sandbox via its /auth/:provider endpoint
 */
export async function syncCredentialsToSandbox(
  sandboxUrl: string,
  organizationId: string
): Promise<void> {
  const cacheKey = `${sandboxUrl}:${organizationId}`;
  if (syncedSandboxes.has(cacheKey)) return;
  syncedSandboxes.add(cacheKey);

  try {
    // Fetch credentials from Convex
    const convex = getConvex();
    const credentials = await convex
      .query(api.aiCredentials.getByOrg, { organizationId })
      .catch(() => []);

    if (!credentials || credentials.length === 0) {
      console.log(`[Gateway] No credentials found for org ${organizationId}`);
      return;
    }

    const encryptionKey = Config.ENCRYPTION_KEY;
    const { decrypt } = await import("../orchestrator/index.ts");

    // Inject each credential into the sandbox
    for (const cred of credentials) {
      if (!cred?.provider || !cred?.encryptedKey) continue;
      try {
        const apiKey = await decrypt(String(cred.encryptedKey), encryptionKey);
        const authUrl = `${sandboxUrl}/auth/${cred.provider}`;
        const res = await fetch(authUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "api", key: apiKey }),
        });
        console.log(
          `[Gateway] Synced ${cred.provider} to sandbox: ${res.ok ? "ok" : res.status}`
        );
      } catch (err: any) {
        console.warn(
          `[Gateway] Failed to sync ${cred.provider}: ${err?.message || String(err)}`
        );
      }
    }
  } catch (err: any) {
    console.warn(`[Gateway] Credential sync failed: ${err?.message || String(err)}`);
  }
}

/**
 * Check if a sandbox has been synced
 */
export function isSandboxSynced(sandboxUrl: string, organizationId: string): boolean {
  return syncedSandboxes.has(`${sandboxUrl}:${organizationId}`);
}

/**
 * Clear synced sandboxes (for testing)
 */
export function clearSyncedSandboxes(): void {
  syncedSandboxes.clear();
}
