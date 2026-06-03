import type { PluginInput } from "@opencode-ai/plugin";
import type { ParsedTokenLimitError } from "./types";
import type { ExperimentalConfig } from "../../config";
type OpencodeClient = PluginInput["client"];
export declare function attemptDeduplicationRecovery(sessionID: string, parsed: ParsedTokenLimitError, experimental: ExperimentalConfig | undefined, client?: OpencodeClient): Promise<void>;
export {};
