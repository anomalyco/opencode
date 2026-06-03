import { createSyncSession } from "./sync-session-creator";
import { sendSyncPrompt } from "./sync-prompt-sender";
import { pollSyncSession } from "./sync-session-poller";
import { fetchSyncResult } from "./sync-result-fetcher";
export declare const syncTaskDeps: {
    createSyncSession: typeof createSyncSession;
    sendSyncPrompt: typeof sendSyncPrompt;
    pollSyncSession: typeof pollSyncSession;
    fetchSyncResult: typeof fetchSyncResult;
};
export type SyncTaskDeps = typeof syncTaskDeps;
