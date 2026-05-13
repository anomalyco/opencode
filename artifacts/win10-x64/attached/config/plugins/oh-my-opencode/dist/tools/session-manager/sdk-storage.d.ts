import type { PluginInput } from "@opencode-ai/plugin";
import type { SessionMessage, SessionMetadata, TodoItem } from "./types";
export declare function getSdkMainSessions(client: PluginInput["client"], directory?: string): Promise<SessionMetadata[]>;
export declare function getSdkAllSessions(client: PluginInput["client"]): Promise<string[]>;
export declare function sdkSessionExists(client: PluginInput["client"], sessionID: string): Promise<boolean>;
export declare function getSdkSessionMessages(client: PluginInput["client"], sessionID: string): Promise<SessionMessage[]>;
export declare function getSdkSessionTodos(client: PluginInput["client"], sessionID: string): Promise<TodoItem[]>;
export declare function shouldFallbackFromSdkError(error: unknown): boolean;
