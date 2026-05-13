import type { PluginInput } from "@opencode-ai/plugin";
import { getMessageDir } from "../../shared/opencode-message-dir";
export { getMessageDir };
type OpencodeClient = PluginInput["client"];
export declare function getMessageIdsFromSDK(client: OpencodeClient, sessionID: string): Promise<string[]>;
export declare function getMessageIds(sessionID: string): string[];
