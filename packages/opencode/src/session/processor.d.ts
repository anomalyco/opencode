import { MessageV2 } from "./message-v2";
import type { Provider } from "@/provider/provider";
import { LLM } from "./llm";
import type { SessionID } from "./schema";
export declare namespace SessionProcessor {
    type Info = Awaited<ReturnType<typeof create>>;
    type Result = Awaited<ReturnType<Info["process"]>>;
    function create(input: {
        assistantMessage: MessageV2.Assistant;
        sessionID: SessionID;
        model: Provider.Model;
        abort: AbortSignal;
    }): {
        readonly message: {
            [x: string]: any;
            role: "assistant";
            time: {
                created: number;
                completed?: number | undefined;
            };
            error?: {
                name: "ProviderAuthError";
                data: {
                    providerID: string;
                    message: string;
                };
            } | {
                name: "UnknownError";
                data: {
                    message: string;
                };
            } | {
                name: "MessageOutputLengthError";
                data: Record<string, never>;
            } | {
                name: "MessageAbortedError";
                data: {
                    message: string;
                };
            } | {
                name: "StructuredOutputError";
                data: {
                    message: string;
                    retries: number;
                };
            } | {
                name: "ContextOverflowError";
                data: {
                    message: string;
                    responseBody?: string | undefined;
                };
            } | {
                name: "APIError";
                data: {
                    message: string;
                    statusCode?: number | undefined;
                    isRetryable: boolean;
                    responseHeaders?: Record<string, string> | undefined;
                    responseBody?: string | undefined;
                    metadata?: Record<string, string> | undefined;
                };
            } | undefined;
            modelID: string;
            providerID: string;
            mode: string;
            agent: string;
            path: {
                cwd: string;
                root: string;
            };
            summary?: boolean | undefined;
            cost: number;
            tokens: {
                total?: number | undefined;
                input: number;
                output: number;
                reasoning: number;
                cache: {
                    read: number;
                    write: number;
                };
            };
            structured?: any;
            variant?: string | undefined;
            finish?: string | undefined;
        };
        partFromToolCall(toolCallID: string): {
            [x: string]: any;
            type: "tool";
            callID: string;
            tool: string;
            state: {
                status: "pending";
                input: Record<string, any>;
                raw: string;
            } | {
                status: "running";
                input: Record<string, any>;
                title?: string | undefined;
                metadata?: Record<string, any> | undefined;
                time: {
                    start: number;
                };
            } | {
                status: "completed";
                input: Record<string, any>;
                output: string;
                title: string;
                metadata: Record<string, any>;
                time: {
                    start: number;
                    end: number;
                    compacted?: number | undefined;
                };
                attachments?: {
                    [x: string]: any;
                    type: "file";
                    mime: string;
                    filename?: string | undefined;
                    url: string;
                    source?: {
                        text: {
                            value: string;
                            start: number;
                            end: number;
                        };
                        type: "file";
                        path: string;
                    } | {
                        text: {
                            value: string;
                            start: number;
                            end: number;
                        };
                        type: "symbol";
                        path: string;
                        range: {
                            start: {
                                line: number;
                                character: number;
                            };
                            end: {
                                line: number;
                                character: number;
                            };
                        };
                        name: string;
                        kind: number;
                    } | {
                        text: {
                            value: string;
                            start: number;
                            end: number;
                        };
                        type: "resource";
                        clientName: string;
                        uri: string;
                    } | undefined;
                }[] | undefined;
            } | {
                status: "error";
                input: Record<string, any>;
                error: string;
                metadata?: Record<string, any> | undefined;
                time: {
                    start: number;
                    end: number;
                };
            };
            metadata?: Record<string, any> | undefined;
        };
        process(streamInput: LLM.StreamInput): Promise<"compact" | "continue" | "stop">;
    };
}
