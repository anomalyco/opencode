import z from "zod";
import { type ModelMessage } from "ai";
import type { Provider } from "@/provider/provider";
export declare namespace MessageV2 {
    function isMedia(mime: string): boolean;
    const OutputLengthError: {
        new (data: Record<string, never>, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "MessageOutputLengthError";
            readonly data: Record<string, never>;
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MessageOutputLengthError">;
                data: z.ZodObject<{}, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MessageOutputLengthError";
                data: Record<string, never>;
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
            name: z.ZodLiteral<"MessageOutputLengthError">;
            data: z.ZodObject<{}, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "MessageOutputLengthError";
            readonly data: Record<string, never>;
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MessageOutputLengthError">;
                data: z.ZodObject<{}, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MessageOutputLengthError";
                data: Record<string, never>;
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
    const AbortedError: {
        new (data: {
            message: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "MessageAbortedError";
            readonly data: {
                message: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MessageAbortedError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MessageAbortedError";
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
            name: z.ZodLiteral<"MessageAbortedError">;
            data: z.ZodObject<{
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "MessageAbortedError";
            readonly data: {
                message: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"MessageAbortedError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "MessageAbortedError";
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
    const StructuredOutputError: {
        new (data: {
            message: string;
            retries: number;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "StructuredOutputError";
            readonly data: {
                message: string;
                retries: number;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"StructuredOutputError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    retries: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "StructuredOutputError";
                data: {
                    message: string;
                    retries: number;
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
            name: z.ZodLiteral<"StructuredOutputError">;
            data: z.ZodObject<{
                message: z.ZodString;
                retries: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "StructuredOutputError";
            readonly data: {
                message: string;
                retries: number;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"StructuredOutputError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    retries: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "StructuredOutputError";
                data: {
                    message: string;
                    retries: number;
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
    const AuthError: {
        new (data: {
            providerID: string;
            message: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderAuthError";
            readonly data: {
                providerID: string;
                message: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthError";
                data: {
                    providerID: string;
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
            name: z.ZodLiteral<"ProviderAuthError">;
            data: z.ZodObject<{
                providerID: z.ZodString;
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderAuthError";
            readonly data: {
                providerID: string;
                message: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthError";
                data: {
                    providerID: string;
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
    const APIError: {
        new (data: {
            message: string;
            statusCode?: number | undefined;
            isRetryable: boolean;
            responseHeaders?: Record<string, string> | undefined;
            responseBody?: string | undefined;
            metadata?: Record<string, string> | undefined;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "APIError";
            readonly data: {
                message: string;
                statusCode?: number | undefined;
                isRetryable: boolean;
                responseHeaders?: Record<string, string> | undefined;
                responseBody?: string | undefined;
                metadata?: Record<string, string> | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"APIError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    statusCode: z.ZodOptional<z.ZodNumber>;
                    isRetryable: z.ZodBoolean;
                    responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    responseBody: z.ZodOptional<z.ZodString>;
                    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
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
            message: string;
            stack?: string | undefined;
            readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
            readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
            readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
            readonly "~effect/Runtime/errorExitCode"?: number | undefined;
            readonly "~effect/Runtime/errorReported"?: boolean | undefined;
        };
        readonly Schema: z.ZodObject<{
            name: z.ZodLiteral<"APIError">;
            data: z.ZodObject<{
                message: z.ZodString;
                statusCode: z.ZodOptional<z.ZodNumber>;
                isRetryable: z.ZodBoolean;
                responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                responseBody: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "APIError";
            readonly data: {
                message: string;
                statusCode?: number | undefined;
                isRetryable: boolean;
                responseHeaders?: Record<string, string> | undefined;
                responseBody?: string | undefined;
                metadata?: Record<string, string> | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"APIError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    statusCode: z.ZodOptional<z.ZodNumber>;
                    isRetryable: z.ZodBoolean;
                    responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    responseBody: z.ZodOptional<z.ZodString>;
                    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
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
    type APIError = z.infer<typeof APIError.Schema>;
    const ContextOverflowError: {
        new (data: {
            message: string;
            responseBody?: string | undefined;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ContextOverflowError";
            readonly data: {
                message: string;
                responseBody?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ContextOverflowError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    responseBody: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ContextOverflowError";
                data: {
                    message: string;
                    responseBody?: string | undefined;
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
            name: z.ZodLiteral<"ContextOverflowError">;
            data: z.ZodObject<{
                message: z.ZodString;
                responseBody: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ContextOverflowError";
            readonly data: {
                message: string;
                responseBody?: string | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ContextOverflowError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    responseBody: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ContextOverflowError";
                data: {
                    message: string;
                    responseBody?: string | undefined;
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
    const OutputFormatText: z.ZodObject<{
        type: z.ZodLiteral<"text">;
    }, z.core.$strip>;
    const OutputFormatJsonSchema: z.ZodObject<{
        type: z.ZodLiteral<"json_schema">;
        schema: z.ZodRecord<z.ZodString, z.ZodAny>;
        retryCount: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    const Format: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"json_schema">;
        schema: z.ZodRecord<z.ZodString, z.ZodAny>;
        retryCount: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>], "type">;
    type OutputFormat = z.infer<typeof Format>;
    const SnapshotPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"snapshot">;
        snapshot: z.ZodString;
    }, z.core.$strip>;
    type SnapshotPart = z.infer<typeof SnapshotPart>;
    const PatchPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"patch">;
        hash: z.ZodString;
        files: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    type PatchPart = z.infer<typeof PatchPart>;
    const TextPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        synthetic: z.ZodOptional<z.ZodBoolean>;
        ignored: z.ZodOptional<z.ZodBoolean>;
        time: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>;
    type TextPart = z.infer<typeof TextPart>;
    const ReasoningPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"reasoning">;
        text: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type ReasoningPart = z.infer<typeof ReasoningPart>;
    const FileSource: z.ZodObject<{
        text: z.ZodObject<{
            value: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>;
        type: z.ZodLiteral<"file">;
        path: z.ZodString;
    }, z.core.$strip>;
    const SymbolSource: z.ZodObject<{
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
    }, z.core.$strip>;
    const ResourceSource: z.ZodObject<{
        text: z.ZodObject<{
            value: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>;
        type: z.ZodLiteral<"resource">;
        clientName: z.ZodString;
        uri: z.ZodString;
    }, z.core.$strip>;
    const FilePartSource: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strip>], "type">;
    const FilePart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
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
    }, z.core.$strip>;
    type FilePart = z.infer<typeof FilePart>;
    const AgentPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"agent">;
        name: z.ZodString;
        source: z.ZodOptional<z.ZodObject<{
            value: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    type AgentPart = z.infer<typeof AgentPart>;
    const CompactionPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"compaction">;
        auto: z.ZodBoolean;
        overflow: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    type CompactionPart = z.infer<typeof CompactionPart>;
    const SubtaskPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"subtask">;
        prompt: z.ZodString;
        description: z.ZodString;
        agent: z.ZodString;
        model: z.ZodOptional<z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>>;
        command: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type SubtaskPart = z.infer<typeof SubtaskPart>;
    const RetryPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"retry">;
        attempt: z.ZodNumber;
        error: z.ZodObject<{
            name: z.ZodLiteral<"APIError">;
            data: z.ZodObject<{
                message: z.ZodString;
                statusCode: z.ZodOptional<z.ZodNumber>;
                isRetryable: z.ZodBoolean;
                responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                responseBody: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        time: z.ZodObject<{
            created: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type RetryPart = z.infer<typeof RetryPart>;
    const StepStartPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"step-start">;
        snapshot: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type StepStartPart = z.infer<typeof StepStartPart>;
    const StepFinishPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"step-finish">;
        reason: z.ZodString;
        snapshot: z.ZodOptional<z.ZodString>;
        cost: z.ZodNumber;
        tokens: z.ZodObject<{
            total: z.ZodOptional<z.ZodNumber>;
            input: z.ZodNumber;
            output: z.ZodNumber;
            reasoning: z.ZodNumber;
            cache: z.ZodObject<{
                read: z.ZodNumber;
                write: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type StepFinishPart = z.infer<typeof StepFinishPart>;
    const ToolStatePending: z.ZodObject<{
        status: z.ZodLiteral<"pending">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        raw: z.ZodString;
    }, z.core.$strip>;
    type ToolStatePending = z.infer<typeof ToolStatePending>;
    const ToolStateRunning: z.ZodObject<{
        status: z.ZodLiteral<"running">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        title: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type ToolStateRunning = z.infer<typeof ToolStateRunning>;
    const ToolStateCompleted: z.ZodObject<{
        status: z.ZodLiteral<"completed">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        output: z.ZodString;
        title: z.ZodString;
        metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            compacted: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
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
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    type ToolStateCompleted = z.infer<typeof ToolStateCompleted>;
    const ToolStateError: z.ZodObject<{
        status: z.ZodLiteral<"error">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        error: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    type ToolStateError = z.infer<typeof ToolStateError>;
    const ToolState: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"pending">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        raw: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"running">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        title: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"completed">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        output: z.ZodString;
        title: z.ZodString;
        metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
            compacted: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
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
        }, z.core.$strip>>>;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"error">;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        error: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>], "status">;
    const ToolPart: z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"tool">;
        callID: z.ZodString;
        tool: z.ZodString;
        state: z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"pending">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            raw: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"running">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            title: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            time: z.ZodObject<{
                start: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"completed">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            output: z.ZodString;
            title: z.ZodString;
            metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
            time: z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
                compacted: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: any;
                sessionID: any;
                messageID: any;
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
            }, z.core.$strip>>>;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"error">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            error: z.ZodString;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            time: z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>], "status">;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>;
    type ToolPart = z.infer<typeof ToolPart>;
    const User: z.ZodObject<{
        id: any;
        sessionID: any;
        role: z.ZodLiteral<"user">;
        time: z.ZodObject<{
            created: z.ZodNumber;
        }, z.core.$strip>;
        format: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"json_schema">;
            schema: z.ZodRecord<z.ZodString, z.ZodAny>;
            retryCount: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>], "type">>;
        summary: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            body: z.ZodOptional<z.ZodString>;
            diffs: any;
        }, z.core.$strip>>;
        agent: z.ZodString;
        model: z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>;
        system: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        variant: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type User = z.infer<typeof User>;
    const Part: z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
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
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"subtask">;
        prompt: z.ZodString;
        description: z.ZodString;
        agent: z.ZodString;
        model: z.ZodOptional<z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>>;
        command: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"reasoning">;
        text: z.ZodString;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        time: z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
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
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"tool">;
        callID: z.ZodString;
        tool: z.ZodString;
        state: z.ZodDiscriminatedUnion<[z.ZodObject<{
            status: z.ZodLiteral<"pending">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            raw: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"running">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            title: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            time: z.ZodObject<{
                start: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"completed">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            output: z.ZodString;
            title: z.ZodString;
            metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
            time: z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
                compacted: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
            attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: any;
                sessionID: any;
                messageID: any;
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
            }, z.core.$strip>>>;
        }, z.core.$strip>, z.ZodObject<{
            status: z.ZodLiteral<"error">;
            input: z.ZodRecord<z.ZodString, z.ZodAny>;
            error: z.ZodString;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            time: z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>], "status">;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"step-start">;
        snapshot: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"step-finish">;
        reason: z.ZodString;
        snapshot: z.ZodOptional<z.ZodString>;
        cost: z.ZodNumber;
        tokens: z.ZodObject<{
            total: z.ZodOptional<z.ZodNumber>;
            input: z.ZodNumber;
            output: z.ZodNumber;
            reasoning: z.ZodNumber;
            cache: z.ZodObject<{
                read: z.ZodNumber;
                write: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"snapshot">;
        snapshot: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"patch">;
        hash: z.ZodString;
        files: z.ZodArray<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"agent">;
        name: z.ZodString;
        source: z.ZodOptional<z.ZodObject<{
            value: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"retry">;
        attempt: z.ZodNumber;
        error: z.ZodObject<{
            name: z.ZodLiteral<"APIError">;
            data: z.ZodObject<{
                message: z.ZodString;
                statusCode: z.ZodOptional<z.ZodNumber>;
                isRetryable: z.ZodBoolean;
                responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                responseBody: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        time: z.ZodObject<{
            created: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        messageID: any;
        type: z.ZodLiteral<"compaction">;
        auto: z.ZodBoolean;
        overflow: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>], "type">;
    type Part = z.infer<typeof Part>;
    const Assistant: z.ZodObject<{
        id: any;
        sessionID: any;
        role: z.ZodLiteral<"assistant">;
        time: z.ZodObject<{
            created: z.ZodNumber;
            completed: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        error: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            name: z.ZodLiteral<"ProviderAuthError">;
            data: z.ZodObject<{
                providerID: z.ZodString;
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"UnknownError">;
            data: z.ZodObject<{
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"MessageOutputLengthError">;
            data: z.ZodObject<{}, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"MessageAbortedError">;
            data: z.ZodObject<{
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"StructuredOutputError">;
            data: z.ZodObject<{
                message: z.ZodString;
                retries: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"ContextOverflowError">;
            data: z.ZodObject<{
                message: z.ZodString;
                responseBody: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"APIError">;
            data: z.ZodObject<{
                message: z.ZodString;
                statusCode: z.ZodOptional<z.ZodNumber>;
                isRetryable: z.ZodBoolean;
                responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                responseBody: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>], "name">>;
        parentID: any;
        modelID: z.ZodString;
        providerID: z.ZodString;
        mode: z.ZodString;
        agent: z.ZodString;
        path: z.ZodObject<{
            cwd: z.ZodString;
            root: z.ZodString;
        }, z.core.$strip>;
        summary: z.ZodOptional<z.ZodBoolean>;
        cost: z.ZodNumber;
        tokens: z.ZodObject<{
            total: z.ZodOptional<z.ZodNumber>;
            input: z.ZodNumber;
            output: z.ZodNumber;
            reasoning: z.ZodNumber;
            cache: z.ZodObject<{
                read: z.ZodNumber;
                write: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        structured: z.ZodOptional<z.ZodAny>;
        variant: z.ZodOptional<z.ZodString>;
        finish: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type Assistant = z.infer<typeof Assistant>;
    const Info: z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: any;
        sessionID: any;
        role: z.ZodLiteral<"user">;
        time: z.ZodObject<{
            created: z.ZodNumber;
        }, z.core.$strip>;
        format: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"json_schema">;
            schema: z.ZodRecord<z.ZodString, z.ZodAny>;
            retryCount: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>], "type">>;
        summary: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            body: z.ZodOptional<z.ZodString>;
            diffs: any;
        }, z.core.$strip>>;
        agent: z.ZodString;
        model: z.ZodObject<{
            providerID: z.ZodString;
            modelID: z.ZodString;
        }, z.core.$strip>;
        system: z.ZodOptional<z.ZodString>;
        tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        variant: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        id: any;
        sessionID: any;
        role: z.ZodLiteral<"assistant">;
        time: z.ZodObject<{
            created: z.ZodNumber;
            completed: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
        error: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
            name: z.ZodLiteral<"ProviderAuthError">;
            data: z.ZodObject<{
                providerID: z.ZodString;
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"UnknownError">;
            data: z.ZodObject<{
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"MessageOutputLengthError">;
            data: z.ZodObject<{}, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"MessageAbortedError">;
            data: z.ZodObject<{
                message: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"StructuredOutputError">;
            data: z.ZodObject<{
                message: z.ZodString;
                retries: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"ContextOverflowError">;
            data: z.ZodObject<{
                message: z.ZodString;
                responseBody: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            name: z.ZodLiteral<"APIError">;
            data: z.ZodObject<{
                message: z.ZodString;
                statusCode: z.ZodOptional<z.ZodNumber>;
                isRetryable: z.ZodBoolean;
                responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                responseBody: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>], "name">>;
        parentID: any;
        modelID: z.ZodString;
        providerID: z.ZodString;
        mode: z.ZodString;
        agent: z.ZodString;
        path: z.ZodObject<{
            cwd: z.ZodString;
            root: z.ZodString;
        }, z.core.$strip>;
        summary: z.ZodOptional<z.ZodBoolean>;
        cost: z.ZodNumber;
        tokens: z.ZodObject<{
            total: z.ZodOptional<z.ZodNumber>;
            input: z.ZodNumber;
            output: z.ZodNumber;
            reasoning: z.ZodNumber;
            cache: z.ZodObject<{
                read: z.ZodNumber;
                write: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        structured: z.ZodOptional<z.ZodAny>;
        variant: z.ZodOptional<z.ZodString>;
        finish: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "role">;
    type Info = z.infer<typeof Info>;
    const Event: {
        Updated: any;
        Removed: any;
        PartUpdated: any;
        PartDelta: any;
        PartRemoved: any;
    };
    const WithParts: z.ZodObject<{
        info: z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: any;
            sessionID: any;
            role: z.ZodLiteral<"user">;
            time: z.ZodObject<{
                created: z.ZodNumber;
            }, z.core.$strip>;
            format: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"json_schema">;
                schema: z.ZodRecord<z.ZodString, z.ZodAny>;
                retryCount: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>], "type">>;
            summary: z.ZodOptional<z.ZodObject<{
                title: z.ZodOptional<z.ZodString>;
                body: z.ZodOptional<z.ZodString>;
                diffs: any;
            }, z.core.$strip>>;
            agent: z.ZodString;
            model: z.ZodObject<{
                providerID: z.ZodString;
                modelID: z.ZodString;
            }, z.core.$strip>;
            system: z.ZodOptional<z.ZodString>;
            tools: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            variant: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            role: z.ZodLiteral<"assistant">;
            time: z.ZodObject<{
                created: z.ZodNumber;
                completed: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
            error: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"UnknownError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"MessageOutputLengthError">;
                data: z.ZodObject<{}, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"MessageAbortedError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"StructuredOutputError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    retries: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"ContextOverflowError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    responseBody: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                name: z.ZodLiteral<"APIError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    statusCode: z.ZodOptional<z.ZodNumber>;
                    isRetryable: z.ZodBoolean;
                    responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    responseBody: z.ZodOptional<z.ZodString>;
                    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>], "name">>;
            parentID: any;
            modelID: z.ZodString;
            providerID: z.ZodString;
            mode: z.ZodString;
            agent: z.ZodString;
            path: z.ZodObject<{
                cwd: z.ZodString;
                root: z.ZodString;
            }, z.core.$strip>;
            summary: z.ZodOptional<z.ZodBoolean>;
            cost: z.ZodNumber;
            tokens: z.ZodObject<{
                total: z.ZodOptional<z.ZodNumber>;
                input: z.ZodNumber;
                output: z.ZodNumber;
                reasoning: z.ZodNumber;
                cache: z.ZodObject<{
                    read: z.ZodNumber;
                    write: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
            structured: z.ZodOptional<z.ZodAny>;
            variant: z.ZodOptional<z.ZodString>;
            finish: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "role">;
        parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
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
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"subtask">;
            prompt: z.ZodString;
            description: z.ZodString;
            agent: z.ZodString;
            model: z.ZodOptional<z.ZodObject<{
                providerID: z.ZodString;
                modelID: z.ZodString;
            }, z.core.$strip>>;
            command: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"reasoning">;
            text: z.ZodString;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            time: z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
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
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"tool">;
            callID: z.ZodString;
            tool: z.ZodString;
            state: z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"pending">;
                input: z.ZodRecord<z.ZodString, z.ZodAny>;
                raw: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"running">;
                input: z.ZodRecord<z.ZodString, z.ZodAny>;
                title: z.ZodOptional<z.ZodString>;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                time: z.ZodObject<{
                    start: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"completed">;
                input: z.ZodRecord<z.ZodString, z.ZodAny>;
                output: z.ZodString;
                title: z.ZodString;
                metadata: z.ZodRecord<z.ZodString, z.ZodAny>;
                time: z.ZodObject<{
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                    compacted: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>;
                attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: any;
                    sessionID: any;
                    messageID: any;
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
                }, z.core.$strip>>>;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"error">;
                input: z.ZodRecord<z.ZodString, z.ZodAny>;
                error: z.ZodString;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
                time: z.ZodObject<{
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>], "status">;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"step-start">;
            snapshot: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"step-finish">;
            reason: z.ZodString;
            snapshot: z.ZodOptional<z.ZodString>;
            cost: z.ZodNumber;
            tokens: z.ZodObject<{
                total: z.ZodOptional<z.ZodNumber>;
                input: z.ZodNumber;
                output: z.ZodNumber;
                reasoning: z.ZodNumber;
                cache: z.ZodObject<{
                    read: z.ZodNumber;
                    write: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"snapshot">;
            snapshot: z.ZodString;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"patch">;
            hash: z.ZodString;
            files: z.ZodArray<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"agent">;
            name: z.ZodString;
            source: z.ZodOptional<z.ZodObject<{
                value: z.ZodString;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"retry">;
            attempt: z.ZodNumber;
            error: z.ZodObject<{
                name: z.ZodLiteral<"APIError">;
                data: z.ZodObject<{
                    message: z.ZodString;
                    statusCode: z.ZodOptional<z.ZodNumber>;
                    isRetryable: z.ZodBoolean;
                    responseHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    responseBody: z.ZodOptional<z.ZodString>;
                    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            time: z.ZodObject<{
                created: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>, z.ZodObject<{
            id: any;
            sessionID: any;
            messageID: any;
            type: z.ZodLiteral<"compaction">;
            auto: z.ZodBoolean;
            overflow: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>], "type">>;
    }, z.core.$strip>;
    type WithParts = z.infer<typeof WithParts>;
    function toModelMessages(input: WithParts[], model: Provider.Model, options?: {
        stripMedia?: boolean;
    }): ModelMessage[];
    const stream: any;
    const parts: any;
    const get: any;
    function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>): Promise<{
        info: {
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
        } | {
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
    }[]>;
    function fromError(e: unknown, ctx: {
        providerID: string;
    }): {
        cause?: unknown;
        readonly name: "MessageOutputLengthError";
        readonly data: Record<string, never>;
        schema(): z.ZodObject<{
            name: z.ZodLiteral<"MessageOutputLengthError">;
            data: z.ZodObject<{}, z.core.$strip>;
        }, z.core.$strip>;
        toObject(): {
            name: "MessageOutputLengthError";
            data: Record<string, never>;
        };
        message: string;
        stack?: string | undefined;
        readonly "~effect/ErrorReporter/ignore"?: boolean | undefined;
        readonly "~effect/ErrorReporter/severity"?: import("effect/LogLevel").Severity | undefined;
        readonly "~effect/ErrorReporter/attributes"?: import("effect/Record").ReadonlyRecord<string, unknown> | undefined;
        readonly "~effect/Runtime/errorExitCode"?: number | undefined;
        readonly "~effect/Runtime/errorReported"?: boolean | undefined;
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
    } | {
        name: "ContextOverflowError";
        data: {
            message: string;
            responseBody?: string | undefined;
        };
    } | {
        name: "MessageAbortedError";
        data: {
            message: string;
        };
    } | {
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
    };
}
