import z from "zod";
export declare namespace Ripgrep {
    const Begin: z.ZodObject<{
        type: z.ZodLiteral<"begin">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    export const Match: z.ZodObject<{
        type: z.ZodLiteral<"match">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            lines: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            line_number: z.ZodNumber;
            absolute_offset: z.ZodNumber;
            submatches: z.ZodArray<z.ZodObject<{
                match: z.ZodObject<{
                    text: z.ZodString;
                }, z.core.$strip>;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    const End: z.ZodObject<{
        type: z.ZodLiteral<"end">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            binary_offset: z.ZodNullable<z.ZodNumber>;
            stats: z.ZodObject<{
                elapsed: z.ZodObject<{
                    secs: z.ZodNumber;
                    nanos: z.ZodNumber;
                    human: z.ZodString;
                }, z.core.$strip>;
                searches: z.ZodNumber;
                searches_with_match: z.ZodNumber;
                bytes_searched: z.ZodNumber;
                bytes_printed: z.ZodNumber;
                matched_lines: z.ZodNumber;
                matches: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    const Summary: z.ZodObject<{
        type: z.ZodLiteral<"summary">;
        data: z.ZodObject<{
            elapsed_total: z.ZodObject<{
                human: z.ZodString;
                nanos: z.ZodNumber;
                secs: z.ZodNumber;
            }, z.core.$strip>;
            stats: z.ZodObject<{
                elapsed: z.ZodObject<{
                    secs: z.ZodNumber;
                    nanos: z.ZodNumber;
                    human: z.ZodString;
                }, z.core.$strip>;
                searches: z.ZodNumber;
                searches_with_match: z.ZodNumber;
                bytes_searched: z.ZodNumber;
                bytes_printed: z.ZodNumber;
                matched_lines: z.ZodNumber;
                matches: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    const Result: z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"begin">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"match">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            lines: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            line_number: z.ZodNumber;
            absolute_offset: z.ZodNumber;
            submatches: z.ZodArray<z.ZodObject<{
                match: z.ZodObject<{
                    text: z.ZodString;
                }, z.core.$strip>;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"end">;
        data: z.ZodObject<{
            path: z.ZodObject<{
                text: z.ZodString;
            }, z.core.$strip>;
            binary_offset: z.ZodNullable<z.ZodNumber>;
            stats: z.ZodObject<{
                elapsed: z.ZodObject<{
                    secs: z.ZodNumber;
                    nanos: z.ZodNumber;
                    human: z.ZodString;
                }, z.core.$strip>;
                searches: z.ZodNumber;
                searches_with_match: z.ZodNumber;
                bytes_searched: z.ZodNumber;
                bytes_printed: z.ZodNumber;
                matched_lines: z.ZodNumber;
                matches: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"summary">;
        data: z.ZodObject<{
            elapsed_total: z.ZodObject<{
                human: z.ZodString;
                nanos: z.ZodNumber;
                secs: z.ZodNumber;
            }, z.core.$strip>;
            stats: z.ZodObject<{
                elapsed: z.ZodObject<{
                    secs: z.ZodNumber;
                    nanos: z.ZodNumber;
                    human: z.ZodString;
                }, z.core.$strip>;
                searches: z.ZodNumber;
                searches_with_match: z.ZodNumber;
                bytes_searched: z.ZodNumber;
                bytes_printed: z.ZodNumber;
                matched_lines: z.ZodNumber;
                matches: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>]>;
    export type Result = z.infer<typeof Result>;
    export type Match = z.infer<typeof Match>;
    export type Begin = z.infer<typeof Begin>;
    export type End = z.infer<typeof End>;
    export type Summary = z.infer<typeof Summary>;
    export const ExtractionFailedError: {
        new (data: {
            filepath: string;
            stderr: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "RipgrepExtractionFailedError";
            readonly data: {
                filepath: string;
                stderr: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepExtractionFailedError">;
                data: z.ZodObject<{
                    filepath: z.ZodString;
                    stderr: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepExtractionFailedError";
                data: {
                    filepath: string;
                    stderr: string;
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
            name: z.ZodLiteral<"RipgrepExtractionFailedError">;
            data: z.ZodObject<{
                filepath: z.ZodString;
                stderr: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "RipgrepExtractionFailedError";
            readonly data: {
                filepath: string;
                stderr: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepExtractionFailedError">;
                data: z.ZodObject<{
                    filepath: z.ZodString;
                    stderr: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepExtractionFailedError";
                data: {
                    filepath: string;
                    stderr: string;
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
    export const UnsupportedPlatformError: {
        new (data: {
            platform: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "RipgrepUnsupportedPlatformError";
            readonly data: {
                platform: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepUnsupportedPlatformError">;
                data: z.ZodObject<{
                    platform: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepUnsupportedPlatformError";
                data: {
                    platform: string;
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
            name: z.ZodLiteral<"RipgrepUnsupportedPlatformError">;
            data: z.ZodObject<{
                platform: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "RipgrepUnsupportedPlatformError";
            readonly data: {
                platform: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepUnsupportedPlatformError">;
                data: z.ZodObject<{
                    platform: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepUnsupportedPlatformError";
                data: {
                    platform: string;
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
    export const DownloadFailedError: {
        new (data: {
            url: string;
            status: number;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "RipgrepDownloadFailedError";
            readonly data: {
                url: string;
                status: number;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepDownloadFailedError">;
                data: z.ZodObject<{
                    url: z.ZodString;
                    status: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepDownloadFailedError";
                data: {
                    url: string;
                    status: number;
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
            name: z.ZodLiteral<"RipgrepDownloadFailedError">;
            data: z.ZodObject<{
                url: z.ZodString;
                status: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "RipgrepDownloadFailedError";
            readonly data: {
                url: string;
                status: number;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"RipgrepDownloadFailedError">;
                data: z.ZodObject<{
                    url: z.ZodString;
                    status: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "RipgrepDownloadFailedError";
                data: {
                    url: string;
                    status: number;
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
    export function filepath(): Promise<string>;
    export function files(input: {
        cwd: string;
        glob?: string[];
        hidden?: boolean;
        follow?: boolean;
        maxDepth?: number;
        signal?: AbortSignal;
    }): AsyncGenerator<string, void, unknown>;
    export function tree(input: {
        cwd: string;
        limit?: number;
        signal?: AbortSignal;
    }): Promise<string>;
    export function search(input: {
        cwd: string;
        pattern: string;
        glob?: string[];
        limit?: number;
        follow?: boolean;
    }): Promise<{
        path: {
            text: string;
        };
        lines: {
            text: string;
        };
        line_number: number;
        absolute_offset: number;
        submatches: {
            match: {
                text: string;
            };
            start: number;
            end: number;
        }[];
    }[]>;
    export {};
}
