import type { ToolContextWithMetadata } from "./types";
import type { OpencodeClient } from "./types";
import type { ParentContext } from "./executor-types";
export declare function resolveParentContext(ctx: ToolContextWithMetadata, client: OpencodeClient): Promise<ParentContext>;
