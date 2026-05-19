import type { BackgroundTask } from "../../features/background-agent";
import type { BackgroundOutputClient } from "./clients";
export declare function formatFullSession(task: BackgroundTask, client: BackgroundOutputClient, options: {
    includeThinking: boolean;
    messageLimit?: number;
    sinceMessageId?: string;
    includeToolResults: boolean;
    thinkingMaxChars?: number;
}): Promise<string>;
