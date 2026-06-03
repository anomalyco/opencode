import type { RunOptions } from "./types";
import { resolveRunAgent } from "./agent-resolver";
export { resolveRunAgent };
export declare function waitForEventProcessorShutdown(eventProcessor: Promise<void>, timeoutMs?: number): Promise<void>;
export declare function run(options: RunOptions): Promise<number>;
