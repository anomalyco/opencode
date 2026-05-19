import type { OhMyOpenCodeConfig } from "../config/schema";
export { McpNameSchema, type McpName } from "./types";
type RemoteMcpConfig = {
    type: "remote";
    url: string;
    enabled: boolean;
    headers?: Record<string, string>;
    oauth?: false;
};
export declare function createBuiltinMcps(disabledMcps?: string[], config?: OhMyOpenCodeConfig): Record<string, RemoteMcpConfig>;
