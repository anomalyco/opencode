import type { HookDeps } from "./types";
import { extractAutoRetrySignal } from "./error-classifier";
export declare function hasVisibleAssistantResponse(extractAutoRetrySignalFn: typeof extractAutoRetrySignal): (ctx: HookDeps["ctx"], sessionID: string, _info: Record<string, unknown> | undefined) => Promise<boolean>;
