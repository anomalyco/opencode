import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types";
import z from "zod";
import type { LSPServer } from "./server";
export declare namespace LSPClient {
    type Info = NonNullable<Awaited<ReturnType<typeof create>>>;
    type Diagnostic = VSCodeDiagnostic;
    const InitializeError: {
        new (data: {
            serverID: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "LSPInitializeError";
            readonly data: {
                serverID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"LSPInitializeError">;
                data: z.ZodObject<{
                    serverID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "LSPInitializeError";
                data: {
                    serverID: string;
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
            name: z.ZodLiteral<"LSPInitializeError">;
            data: z.ZodObject<{
                serverID: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "LSPInitializeError";
            readonly data: {
                serverID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"LSPInitializeError">;
                data: z.ZodObject<{
                    serverID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "LSPInitializeError";
                data: {
                    serverID: string;
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
    const Event: {
        Diagnostics: any;
    };
    function create(input: {
        serverID: string;
        server: LSPServer.Handle;
        root: string;
    }): Promise<{
        root: string;
        readonly serverID: string;
        readonly connection: import("vscode-jsonrpc").MessageConnection;
        notify: {
            open(input: {
                path: string;
            }): Promise<void>;
        };
        readonly diagnostics: Map<string, VSCodeDiagnostic[]>;
        waitForDiagnostics(input: {
            path: string;
        }): Promise<void>;
        shutdown(): Promise<void>;
    }>;
}
