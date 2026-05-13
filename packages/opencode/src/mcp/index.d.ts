import { type Tool } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Config } from "../config/config";
import z from "zod/v4";
export declare namespace MCP {
    export const Resource: z.ZodObject<{
        name: z.ZodString;
        uri: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        mimeType: z.ZodOptional<z.ZodString>;
        client: z.ZodString;
    }, z.core.$strip>;
    export type Resource = z.infer<typeof Resource>;
    export const ToolsChanged: {
        type: "mcp.tools.changed";
        properties: z.ZodObject<{
            server: z.ZodString;
        }, z.core.$strip>;
    };
    export const BrowserOpenFailed: {
        type: "mcp.browser.open.failed";
        properties: z.ZodObject<{
            mcpName: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>;
    };
    export const Failed: {
        new (data: {
            name: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "MCPFailed";
            readonly data: {
                name: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MCPFailed">;
                data: z.ZodObject<{
                    name: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MCPFailed";
                data: {
                    name: string;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        readonly Schema: z.ZodObject<{
            name: z.ZodLiteral<"MCPFailed">;
            data: z.ZodObject<{
                name: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "MCPFailed";
            readonly data: {
                name: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MCPFailed">;
                data: z.ZodObject<{
                    name: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MCPFailed";
                data: {
                    name: string;
                };
            };
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        isError(error: unknown): error is Error;
        isError(value: unknown): value is Error;
        prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
        stackTraceLimit: number;
        create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
            new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<Name>;
                data: Data;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: Name;
                readonly data: z.input<Data>;
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                toObject(): {
                    name: Name;
                    data: z.input<Data>;
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
            readonly Unknown: {
                new (data: {
                    message: string;
                }, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: "UnknownError";
                    readonly data: {
                        message: string;
                    };
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<"UnknownError">;
                        data: z.ZodObject<{
                            message: z.ZodString;
                        }, z.core.$strip>;
                    }, z.core.$strip>;
                    toObject(): {
                        name: "UnknownError";
                        data: {
                            message: string;
                        };
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
        };
        readonly Unknown: {
            new (data: {
                message: string;
            }, options?: ErrorOptions | undefined): {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            readonly Schema: z.ZodObject<{
                name: z.ZodLiteral<"UnknownError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            isInstance(input: any): input is {
                cause?: unknown;
                readonly name: "UnknownError";
                readonly data: {
                    message: string;
                };
                schema(): z.ZodObject<{
                    name: z.ZodLiteral<"UnknownError">;
                    data: z.ZodObject<{
                        message: z.ZodString;
                    }, z.core.$strip>;
                }, z.core.$strip>;
                toObject(): {
                    name: "UnknownError";
                    data: {
                        message: string;
                    };
                };
                message: string;
                stack?: string | undefined;
                readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                readonly "~effect/Runtime/errorReported"?: boolean | undefined;
            };
            isError(error: unknown): error is Error;
            isError(value: unknown): value is Error;
            prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
            stackTraceLimit: number;
            create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): {
                new (data: z.input<Data>, options?: ErrorOptions | undefined): {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                readonly Schema: z.ZodObject<{
                    name: z.ZodLiteral<Name>;
                    data: Data;
                }, z.core.$strip>;
                isInstance(input: any): input is {
                    cause?: unknown;
                    readonly name: Name;
                    readonly data: z.input<Data>;
                    schema(): z.ZodObject<{
                        name: z.ZodLiteral<Name>;
                        data: Data;
                    }, z.core.$strip>;
                    toObject(): {
                        name: Name;
                        data: z.input<Data>;
                    };
                    message: string;
                    stack?: string | undefined;
                    readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
                    readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
                    readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
                    readonly "~effect/Runtime/errorExitCode"?: number | undefined;
                    readonly "~effect/Runtime/errorReported"?: boolean | undefined;
                };
                isError(error: unknown): error is Error;
                isError(value: unknown): value is Error;
                prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                captureStackTrace(targetObject: object, constructorOpt?: Function | undefined): void;
                stackTraceLimit: number;
                create<Name extends string, Data extends z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>(name: Name, data: Data): /*elided*/ any;
                readonly Unknown: /*elided*/ any;
            };
            readonly Unknown: /*elided*/ any;
        };
    };
    type MCPClient = Client;
    export const Status: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"connected">;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"disabled">;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"failed">;
        error: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"needs_auth">;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"needs_client_registration">;
        error: z.ZodString;
    }, z.core.$strip>], "status">;
    export type Status = z.infer<typeof Status>;
    export function add(name: string, mcp: Config.Mcp): Promise<{
        status: {
            status: "failed";
            error: string;
        };
    } | {
        status: Record<string, {
            status: "connected";
        } | {
            status: "disabled";
        } | {
            status: "failed";
            error: string;
        } | {
            status: "needs_auth";
        } | {
            status: "needs_client_registration";
            error: string;
        }>;
    }>;
    export function status(): Promise<Record<string, {
        status: "connected";
    } | {
        status: "disabled";
    } | {
        status: "failed";
        error: string;
    } | {
        status: "needs_auth";
    } | {
        status: "needs_client_registration";
        error: string;
    }>>;
    export function clients(): Promise<Record<string, MCPClient>>;
    export function connect(name: string): Promise<void>;
    export function disconnect(name: string): Promise<void>;
    export function tools(): Promise<Record<string, Tool>>;
    export function prompts(): Promise<{
        [k: string]: {
            name: string;
            description?: string | undefined;
            arguments?: {
                name: string;
                description?: string | undefined;
                required?: boolean | undefined;
            }[] | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
            icons?: {
                src: string;
                mimeType?: string | undefined;
                sizes?: string[] | undefined;
                theme?: "dark" | "light" | undefined;
            }[] | undefined;
            title?: string | undefined;
        } & {
            client: string;
        };
    }>;
    export function resources(): Promise<{
        [k: string]: {
            uri: string;
            name: string;
            description?: string | undefined;
            mimeType?: string | undefined;
            annotations?: {
                audience?: ("assistant" | "user")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
            icons?: {
                src: string;
                mimeType?: string | undefined;
                sizes?: string[] | undefined;
                theme?: "dark" | "light" | undefined;
            }[] | undefined;
            title?: string | undefined;
        } & {
            client: string;
        };
    }>;
    export function getPrompt(clientName: string, name: string, args?: Record<string, string>): Promise<{
        [x: string]: unknown;
        messages: {
            role: "assistant" | "user";
            content: {
                type: "text";
                text: string;
                annotations?: {
                    audience?: ("assistant" | "user")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "image";
                data: string;
                mimeType: string;
                annotations?: {
                    audience?: ("assistant" | "user")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "audio";
                data: string;
                mimeType: string;
                annotations?: {
                    audience?: ("assistant" | "user")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                type: "resource";
                resource: {
                    uri: string;
                    text: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                } | {
                    uri: string;
                    blob: string;
                    mimeType?: string | undefined;
                    _meta?: Record<string, unknown> | undefined;
                };
                annotations?: {
                    audience?: ("assistant" | "user")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: Record<string, unknown> | undefined;
            } | {
                uri: string;
                name: string;
                type: "resource_link";
                description?: string | undefined;
                mimeType?: string | undefined;
                annotations?: {
                    audience?: ("assistant" | "user")[] | undefined;
                    priority?: number | undefined;
                    lastModified?: string | undefined;
                } | undefined;
                _meta?: {
                    [x: string]: unknown;
                } | undefined;
                icons?: {
                    src: string;
                    mimeType?: string | undefined;
                    sizes?: string[] | undefined;
                    theme?: "dark" | "light" | undefined;
                }[] | undefined;
                title?: string | undefined;
            };
        }[];
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
        description?: string | undefined;
    } | undefined>;
    export function readResource(clientName: string, resourceUri: string): Promise<{
        [x: string]: unknown;
        contents: ({
            uri: string;
            text: string;
            mimeType?: string | undefined;
            _meta?: Record<string, unknown> | undefined;
        } | {
            uri: string;
            blob: string;
            mimeType?: string | undefined;
            _meta?: Record<string, unknown> | undefined;
        })[];
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined>;
    /**
     * Start OAuth authentication flow for an MCP server.
     * Returns the authorization URL that should be opened in a browser.
     */
    export function startAuth(mcpName: string): Promise<{
        authorizationUrl: string;
    }>;
    /**
     * Complete OAuth authentication after user authorizes in browser.
     * Opens the browser and waits for callback.
     */
    export function authenticate(mcpName: string): Promise<Status>;
    /**
     * Complete OAuth authentication with the authorization code.
     */
    export function finishAuth(mcpName: string, authorizationCode: string): Promise<Status>;
    /**
     * Remove OAuth credentials for an MCP server.
     */
    export function removeAuth(mcpName: string): Promise<void>;
    /**
     * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
     */
    export function supportsOAuth(mcpName: string): Promise<boolean>;
    /**
     * Check if an MCP server has stored OAuth tokens.
     */
    export function hasStoredTokens(mcpName: string): Promise<boolean>;
    export type AuthStatus = "authenticated" | "expired" | "not_authenticated";
    /**
     * Get the authentication status for an MCP server.
     */
    export function getAuthStatus(mcpName: string): Promise<AuthStatus>;
    export {};
}
