import type { OAuthTokenData } from "./storage";
/**
 * Execute a token refresh with per-server mutual exclusion.
 *
 * If a refresh is already in progress for the given server, this will
 * return the same promise to all concurrent callers. Once the refresh
 * completes (success or failure), the lock is released.
 *
 * @param serverUrl - The OAuth server URL (used as mutex key)
 * @param refreshFn - The actual refresh operation to execute
 * @returns Promise that resolves to the new token data
 */
export declare function withRefreshMutex(serverUrl: string, refreshFn: () => Promise<OAuthTokenData>): Promise<OAuthTokenData>;
/**
 * Check if a refresh is currently in progress for a server.
 *
 * @param serverUrl - The OAuth server URL
 * @returns true if a refresh operation is active
 */
export declare function isRefreshInProgress(serverUrl: string): boolean;
/**
 * Get the number of servers currently undergoing token refresh.
 *
 * @returns Number of active refresh operations
 */
export declare function getActiveRefreshCount(): number;
