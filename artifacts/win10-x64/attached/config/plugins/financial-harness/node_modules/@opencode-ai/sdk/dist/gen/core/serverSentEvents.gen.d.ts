import type { Config } from "./types.gen.js";
export type ServerSentEventsOptions<TData = unknown> = Omit<RequestInit, "method"> & Pick<Config, "method" | "responseTransformer" | "responseValidator"> & {
    /**
     * Callback invoked when a network or parsing error occurs during streaming.
     *
     * This option applies only if the endpoint returns a stream of events.
     *
     * @param error The error that occurred.
     */
    onSseError?: (error: unknown) => void;
    /**
     * Callback invoked when an event is streamed from the server.
     *
     * This option applies only if the endpoint returns a stream of events.
     *
     * @param event Event streamed from the server.
     * @returns Nothing (void).
     */
    onSseEvent?: (event: StreamEvent<TData>) => void;
    /**
     * Default retry delay in milliseconds.
     *
     * This option applies only if the endpoint returns a stream of events.
     *
     * @default 3000
     */
    sseDefaultRetryDelay?: number;
    /**
     * Maximum number of retry attempts before giving up.
     */
    sseMaxRetryAttempts?: number;
    /**
     * Maximum retry delay in milliseconds.
     *
     * Applies only when exponential backoff is used.
     *
     * This option applies only if the endpoint returns a stream of events.
     *
     * @default 30000
     */
    sseMaxRetryDelay?: number;
    /**
     * Optional sleep function for retry backoff.
     *
     * Defaults to using `setTimeout`.
     */
    sseSleepFn?: (ms: number) => Promise<void>;
    url: string;
};
export interface StreamEvent<TData = unknown> {
    data: TData;
    event?: string;
    id?: string;
    retry?: number;
}
export type ServerSentEventsResult<TData = unknown, TReturn = void, TNext = unknown> = {
    stream: AsyncGenerator<TData extends Record<string, unknown> ? TData[keyof TData] : TData, TReturn, TNext>;
};
export declare const createSseClient: <TData = unknown>({ onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }: ServerSentEventsOptions) => ServerSentEventsResult<TData>;
