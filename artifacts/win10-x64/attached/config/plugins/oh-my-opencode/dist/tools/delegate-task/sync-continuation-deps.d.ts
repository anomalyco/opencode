import { pollSyncSession } from "./sync-session-poller";
import { fetchSyncResult } from "./sync-result-fetcher";
export declare const syncContinuationDeps: {
    pollSyncSession: typeof pollSyncSession;
    fetchSyncResult: typeof fetchSyncResult;
};
export type SyncContinuationDeps = typeof syncContinuationDeps;
