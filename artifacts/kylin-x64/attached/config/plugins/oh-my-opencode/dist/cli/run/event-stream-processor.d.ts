import type { RunContext } from "./types";
import type { EventState } from "./event-state";
export declare function processEvents(ctx: RunContext, stream: AsyncIterable<unknown>, state: EventState): Promise<void>;
