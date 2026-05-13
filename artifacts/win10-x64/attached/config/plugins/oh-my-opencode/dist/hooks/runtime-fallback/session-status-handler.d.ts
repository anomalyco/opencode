import type { HookDeps } from "./types";
import type { AutoRetryHelpers } from "./auto-retry";
export declare function createSessionStatusHandler(deps: HookDeps, helpers: AutoRetryHelpers, sessionStatusRetryKeys: Map<string, string>): (props: Record<string, unknown> | undefined) => Promise<void>;
