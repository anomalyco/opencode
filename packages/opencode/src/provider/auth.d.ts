import z from "zod";
export declare namespace ProviderAuth {
    const Method: z.ZodObject<{
        type: z.ZodUnion<readonly [z.ZodLiteral<"oauth">, z.ZodLiteral<"api">]>;
        label: z.ZodString;
    }, z.core.$strip>;
    type Method = z.infer<typeof Method>;
    function methods(): Promise<any>;
    const Authorization: z.ZodObject<{
        url: z.ZodString;
        method: z.ZodUnion<readonly [z.ZodLiteral<"auto">, z.ZodLiteral<"code">]>;
        instructions: z.ZodString;
    }, z.core.$strip>;
    type Authorization = z.infer<typeof Authorization>;
    const authorize: any;
    const callback: any;
    const api: any;
    const OauthMissing: {
        new (data: {
            providerID: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderAuthOauthMissing";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthMissing">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthMissing";
                data: {
                    providerID: string;
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
            name: z.ZodLiteral<"ProviderAuthOauthMissing">;
            data: z.ZodObject<{
                providerID: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderAuthOauthMissing";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthMissing">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthMissing";
                data: {
                    providerID: string;
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
    const OauthCodeMissing: {
        new (data: {
            providerID: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderAuthOauthCodeMissing";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthCodeMissing">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthCodeMissing";
                data: {
                    providerID: string;
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
            name: z.ZodLiteral<"ProviderAuthOauthCodeMissing">;
            data: z.ZodObject<{
                providerID: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderAuthOauthCodeMissing";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthCodeMissing">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthCodeMissing";
                data: {
                    providerID: string;
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
    const OauthCallbackFailed: {
        new (data: Record<string, never>, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderAuthOauthCallbackFailed";
            readonly data: Record<string, never>;
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthCallbackFailed">;
                data: z.ZodObject<{}, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthCallbackFailed";
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
            name: z.ZodLiteral<"ProviderAuthOauthCallbackFailed">;
            data: z.ZodObject<{}, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderAuthOauthCallbackFailed";
            readonly data: Record<string, never>;
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderAuthOauthCallbackFailed">;
                data: z.ZodObject<{}, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderAuthOauthCallbackFailed";
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
}
