import type { NamedError } from "@opencode-ai/util/error";
import { MessageV2 } from "./message-v2";
export declare namespace SessionRetry {
    const RETRY_INITIAL_DELAY = 2000;
    const RETRY_BACKOFF_FACTOR = 2;
    const RETRY_MAX_DELAY_NO_HEADERS = 30000;
    const RETRY_MAX_DELAY = 2147483647;
    function sleep(ms: number, signal: AbortSignal): Promise<void>;
    function delay(attempt: number, error?: MessageV2.APIError): number;
    function retryable(error: ReturnType<NamedError["toObject"]>): string | undefined;
}
