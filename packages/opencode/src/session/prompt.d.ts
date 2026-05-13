import z from "zod";
import { SessionID } from "./schema";
import { MessageV2 } from "./message-v2";
import { Session } from ".";
import { Agent } from "../agent/agent";
import { Provider } from "../provider/provider";
import { type Tool as AITool } from "ai";
import { SessionProcessor } from "./processor";
export declare namespace SessionPrompt {
    function assertNotBusy(sessionID: SessionID): void;
    const PromptInput: z.ZodObject<{
        sessionID: any;
        messageID: any;
        model: z.ZodOptional<z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>>;
        agent: z.ZodOptional<z.ZodString>;
        noReply: z.ZodOptional<z.ZodBoolean>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        format: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"json_schema">;
            schema: z.ZodRecord<z.ZodString, z.ZodAny>;
            retryCount: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>], "type">>;
        system: z.ZodOptional<z.ZodString>;
        variant: z.ZodOptional<z.ZodString>;
        parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: z.ZodOptional<any>;
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            synthetic: z.ZodOptional<z.ZodBoolean>;
            ignored: z.ZodOptional<z.ZodBoolean>;
            time: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodOptional<any>;
            type: z.ZodLiteral<"file">;
            mime: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
            url: z.ZodString;
            source: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"file">;
                path: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"symbol">;
                path: z.ZodString;
                range: z.ZodObject<{
                    start: z.ZodObject<{
                        line: z.ZodNumber;
                        character: z.ZodNumber;
                    }, z.core.$strip>;
                    end: z.ZodObject<{
                        line: z.ZodNumber;
                        character: z.ZodNumber;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                name: z.ZodString;
                kind: z.ZodNumber;
            }, z.core.$strip>, z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"resource">;
                clientName: z.ZodString;
                uri: z.ZodString;
            }, z.core.$strip>], "type">>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodOptional<any>;
            type: z.ZodLiteral<"agent">;
            name: z.ZodString;
            source: z.ZodOptional<z.ZodObject<{
                value: z.ZodString;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            id: z.ZodOptional<any>;
            type: z.ZodLiteral<"subtask">;
            prompt: z.ZodString;
            description: z.ZodString;
            agent: z.ZodString;
            model: z.ZodOptional<z.ZodObject<{
                providerID: z.ZodString;
                modelID: z.ZodString;
            }, z.core.$strip>>;
            command: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">>;
    }, z.core.$strip>;
    type PromptInput = z.infer<typeof PromptInput>;
    const prompt: any;
    function resolvePromptParts(template: string): Promise<PromptInput["parts"]>;
    function cancel(sessionID: SessionID): void;
    const LoopInput: z.ZodObject<{
        sessionID: any;
        resume_existing: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    const loop: any;
    /** @internal Exported for testing */
    function resolveTools(input: {
        agent: Agent.Info;
        model: Provider.Model;
        session: Session.Info;
        tools?: Record<string, boolean>;
        processor: SessionProcessor.Info;
        bypassAgentCheck: boolean;
        messages: MessageV2.WithParts[];
    }): Promise<Record<string, AITool>>;
    /** @internal Exported for testing */
    function createStructuredOutputTool(input: {
        schema: Record<string, any>;
        onSuccess: (output: unknown) => void;
    }): AITool;
    const ShellInput: z.ZodObject<{
        sessionID: any;
        agent: z.ZodString;
        model: z.ZodOptional<z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>>;
        command: z.ZodString;
    }, z.core.$strip>;
    type ShellInput = z.infer<typeof ShellInput>;
    function shell(input: ShellInput): Promise<{
        info: {
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
        parts: {
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
        }[];
    }>;
    const CommandInput: z.ZodObject<{
        messageID: any;
        sessionID: any;
        agent: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        arguments: z.ZodString;
        command: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
        parts: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: z.ZodOptional<any>;
            type: z.ZodLiteral<"file">;
            mime: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
            url: z.ZodString;
            source: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"file">;
                path: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"symbol">;
                path: z.ZodString;
                range: z.ZodObject<{
                    start: z.ZodObject<{
                        line: z.ZodNumber;
                        character: z.ZodNumber;
                    }, z.core.$strip>;
                    end: z.ZodObject<{
                        line: z.ZodNumber;
                        character: z.ZodNumber;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                name: z.ZodString;
                kind: z.ZodNumber;
            }, z.core.$strip>, z.ZodObject<{
                text: z.ZodObject<{
                    value: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
                type: z.ZodLiteral<"resource">;
                clientName: z.ZodString;
                uri: z.ZodString;
            }, z.core.$strip>], "type">>;
        }, z.core.$strip>], "type">>>;
    }, z.core.$strip>;
    type CommandInput = z.infer<typeof CommandInput>;
    /**
     * Regular expression to match @ file references in text
     * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
     * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
     */
    function command(input: CommandInput): Promise<{
        info: {
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
        } | {
            [x: string]: any;
            role: "user";
            time: {
                created: number;
            };
            format?: {
                type: "text";
            } | {
                type: "json_schema";
                schema: Record<string, any>;
                retryCount: number;
            } | undefined;
            summary?: {
                [x: string]: any;
                title?: string | undefined;
                body?: string | undefined;
            } | undefined;
            agent: string;
            model: {
                providerID: string;
                modelID: string;
            };
            system?: string | undefined;
            tools?: Record<string, boolean> | undefined;
            variant?: string | undefined;
        };
        parts: ({
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
        } | {
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
        } | {
            [x: string]: any;
            type: "text";
            text: string;
            synthetic?: boolean | undefined;
            ignored?: boolean | undefined;
            time?: {
                start: number;
                end?: number | undefined;
            } | undefined;
            metadata?: Record<string, any> | undefined;
        } | {
            [x: string]: any;
            type: "subtask";
            prompt: string;
            description: string;
            agent: string;
            model?: {
                providerID: string;
                modelID: string;
            } | undefined;
            command?: string | undefined;
        } | {
            [x: string]: any;
            type: "reasoning";
            text: string;
            metadata?: Record<string, any> | undefined;
            time: {
                start: number;
                end?: number | undefined;
            };
        } | {
            [x: string]: any;
            type: "step-start";
            snapshot?: string | undefined;
        } | {
            [x: string]: any;
            type: "step-finish";
            reason: string;
            snapshot?: string | undefined;
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
        } | {
            [x: string]: any;
            type: "snapshot";
            snapshot: string;
        } | {
            [x: string]: any;
            type: "patch";
            hash: string;
            files: string[];
        } | {
            [x: string]: any;
            type: "agent";
            name: string;
            source?: {
                value: string;
                start: number;
                end: number;
            } | undefined;
        } | {
            [x: string]: any;
            type: "retry";
            attempt: number;
            error: {
                name: "APIError";
                data: {
                    message: string;
                    statusCode?: number | undefined;
                    isRetryable: boolean;
                    responseHeaders?: Record<string, string> | undefined;
                    responseBody?: string | undefined;
                    metadata?: Record<string, string> | undefined;
                };
            };
            time: {
                created: number;
            };
        } | {
            [x: string]: any;
            type: "compaction";
            auto: boolean;
            overflow?: boolean | undefined;
        })[];
    }>;
}
