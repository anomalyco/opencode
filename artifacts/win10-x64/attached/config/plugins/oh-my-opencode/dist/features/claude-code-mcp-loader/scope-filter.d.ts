import type { ClaudeCodeMcpServer } from "./types";
export declare function shouldLoadMcpServer(server: Pick<ClaudeCodeMcpServer, "scope" | "projectPath">, cwd?: string): boolean;
