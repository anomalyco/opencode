import type { HookDeps } from "./types";
import type { AutoRetryHelpers } from "./auto-retry";
export { hasVisibleAssistantResponse } from "./visible-assistant-response";
export declare function createMessageUpdateHandler(deps: HookDeps, helpers: AutoRetryHelpers): (props: Record<string, unknown> | undefined) => Promise<void>;
