import z from "zod";
import { ModelsDev } from "./models";
import { type LanguageModelV2 } from "@openrouter/ai-sdk-provider";
export declare namespace Provider {
    const Model: z.ZodObject<{
        id: z.ZodString;
        providerID: z.ZodString;
        api: z.ZodObject<{
            id: z.ZodString;
            url: z.ZodString;
            npm: z.ZodString;
        }, z.core.$strip>;
        name: z.ZodString;
        family: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodObject<{
            temperature: z.ZodBoolean;
            reasoning: z.ZodBoolean;
            attachment: z.ZodBoolean;
            toolcall: z.ZodBoolean;
            input: z.ZodObject<{
                text: z.ZodBoolean;
                audio: z.ZodBoolean;
                image: z.ZodBoolean;
                video: z.ZodBoolean;
                pdf: z.ZodBoolean;
            }, z.core.$strip>;
            output: z.ZodObject<{
                text: z.ZodBoolean;
                audio: z.ZodBoolean;
                image: z.ZodBoolean;
                video: z.ZodBoolean;
                pdf: z.ZodBoolean;
            }, z.core.$strip>;
            interleaved: z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
                field: z.ZodEnum<{
                    reasoning_content: "reasoning_content";
                    reasoning_details: "reasoning_details";
                }>;
            }, z.core.$strip>]>;
        }, z.core.$strip>;
        cost: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cache: z.ZodObject<{
                read: z.ZodNumber;
                write: z.ZodNumber;
            }, z.core.$strip>;
            experimentalOver200K: z.ZodOptional<z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cache: z.ZodObject<{
                    read: z.ZodNumber;
                    write: z.ZodNumber;
                }, z.core.$strip>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        limit: z.ZodObject<{
            context: z.ZodNumber;
            input: z.ZodOptional<z.ZodNumber>;
            output: z.ZodNumber;
        }, z.core.$strip>;
        status: z.ZodEnum<{
            active: "active";
            alpha: "alpha";
            beta: "beta";
            deprecated: "deprecated";
        }>;
        options: z.ZodRecord<z.ZodString, z.ZodAny>;
        headers: z.ZodRecord<z.ZodString, z.ZodString>;
        release_date: z.ZodString;
        variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>>>;
    }, z.core.$strip>;
    type Model = z.infer<typeof Model>;
    const Info: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        source: z.ZodEnum<{
            api: "api";
            config: "config";
            custom: "custom";
            env: "env";
        }>;
        env: z.ZodArray<z.ZodString>;
        key: z.ZodOptional<z.ZodString>;
        options: z.ZodRecord<z.ZodString, z.ZodAny>;
        models: z.ZodRecord<z.ZodString, z.ZodObject<{
            id: z.ZodString;
            providerID: z.ZodString;
            api: z.ZodObject<{
                id: z.ZodString;
                url: z.ZodString;
                npm: z.ZodString;
            }, z.core.$strip>;
            name: z.ZodString;
            family: z.ZodOptional<z.ZodString>;
            capabilities: z.ZodObject<{
                temperature: z.ZodBoolean;
                reasoning: z.ZodBoolean;
                attachment: z.ZodBoolean;
                toolcall: z.ZodBoolean;
                input: z.ZodObject<{
                    text: z.ZodBoolean;
                    audio: z.ZodBoolean;
                    image: z.ZodBoolean;
                    video: z.ZodBoolean;
                    pdf: z.ZodBoolean;
                }, z.core.$strip>;
                output: z.ZodObject<{
                    text: z.ZodBoolean;
                    audio: z.ZodBoolean;
                    image: z.ZodBoolean;
                    video: z.ZodBoolean;
                    pdf: z.ZodBoolean;
                }, z.core.$strip>;
                interleaved: z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
                    field: z.ZodEnum<{
                        reasoning_content: "reasoning_content";
                        reasoning_details: "reasoning_details";
                    }>;
                }, z.core.$strip>]>;
            }, z.core.$strip>;
            cost: z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cache: z.ZodObject<{
                    read: z.ZodNumber;
                    write: z.ZodNumber;
                }, z.core.$strip>;
                experimentalOver200K: z.ZodOptional<z.ZodObject<{
                    input: z.ZodNumber;
                    output: z.ZodNumber;
                    cache: z.ZodObject<{
                        read: z.ZodNumber;
                        write: z.ZodNumber;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
            limit: z.ZodObject<{
                context: z.ZodNumber;
                input: z.ZodOptional<z.ZodNumber>;
                output: z.ZodNumber;
            }, z.core.$strip>;
            status: z.ZodEnum<{
                active: "active";
                alpha: "alpha";
                beta: "beta";
                deprecated: "deprecated";
            }>;
            options: z.ZodRecord<z.ZodString, z.ZodAny>;
            headers: z.ZodRecord<z.ZodString, z.ZodString>;
            release_date: z.ZodString;
            variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    function fromModelsDevProvider(provider: ModelsDev.Provider): Info;
    function list(): Promise<{
        [providerID: string]: {
            id: string;
            name: string;
            source: "api" | "config" | "custom" | "env";
            env: string[];
            key?: string | undefined;
            options: Record<string, any>;
            models: Record<string, {
                id: string;
                providerID: string;
                api: {
                    id: string;
                    url: string;
                    npm: string;
                };
                name: string;
                family?: string | undefined;
                capabilities: {
                    temperature: boolean;
                    reasoning: boolean;
                    attachment: boolean;
                    toolcall: boolean;
                    input: {
                        text: boolean;
                        audio: boolean;
                        image: boolean;
                        video: boolean;
                        pdf: boolean;
                    };
                    output: {
                        text: boolean;
                        audio: boolean;
                        image: boolean;
                        video: boolean;
                        pdf: boolean;
                    };
                    interleaved: boolean | {
                        field: "reasoning_content" | "reasoning_details";
                    };
                };
                cost: {
                    input: number;
                    output: number;
                    cache: {
                        read: number;
                        write: number;
                    };
                    experimentalOver200K?: {
                        input: number;
                        output: number;
                        cache: {
                            read: number;
                            write: number;
                        };
                    } | undefined;
                };
                limit: {
                    context: number;
                    input?: number | undefined;
                    output: number;
                };
                status: "active" | "alpha" | "beta" | "deprecated";
                options: Record<string, any>;
                headers: Record<string, string>;
                release_date: string;
                variants?: Record<string, Record<string, any>> | undefined;
            }>;
        };
    }>;
    function getProvider(providerID: string): Promise<{
        id: string;
        name: string;
        source: "api" | "config" | "custom" | "env";
        env: string[];
        key?: string | undefined;
        options: Record<string, any>;
        models: Record<string, {
            id: string;
            providerID: string;
            api: {
                id: string;
                url: string;
                npm: string;
            };
            name: string;
            family?: string | undefined;
            capabilities: {
                temperature: boolean;
                reasoning: boolean;
                attachment: boolean;
                toolcall: boolean;
                input: {
                    text: boolean;
                    audio: boolean;
                    image: boolean;
                    video: boolean;
                    pdf: boolean;
                };
                output: {
                    text: boolean;
                    audio: boolean;
                    image: boolean;
                    video: boolean;
                    pdf: boolean;
                };
                interleaved: boolean | {
                    field: "reasoning_content" | "reasoning_details";
                };
            };
            cost: {
                input: number;
                output: number;
                cache: {
                    read: number;
                    write: number;
                };
                experimentalOver200K?: {
                    input: number;
                    output: number;
                    cache: {
                        read: number;
                        write: number;
                    };
                } | undefined;
            };
            limit: {
                context: number;
                input?: number | undefined;
                output: number;
            };
            status: "active" | "alpha" | "beta" | "deprecated";
            options: Record<string, any>;
            headers: Record<string, string>;
            release_date: string;
            variants?: Record<string, Record<string, any>> | undefined;
        }>;
    }>;
    function getModel(providerID: string, modelID: string): Promise<{
        id: string;
        providerID: string;
        api: {
            id: string;
            url: string;
            npm: string;
        };
        name: string;
        family?: string | undefined;
        capabilities: {
            temperature: boolean;
            reasoning: boolean;
            attachment: boolean;
            toolcall: boolean;
            input: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            output: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            interleaved: boolean | {
                field: "reasoning_content" | "reasoning_details";
            };
        };
        cost: {
            input: number;
            output: number;
            cache: {
                read: number;
                write: number;
            };
            experimentalOver200K?: {
                input: number;
                output: number;
                cache: {
                    read: number;
                    write: number;
                };
            } | undefined;
        };
        limit: {
            context: number;
            input?: number | undefined;
            output: number;
        };
        status: "active" | "alpha" | "beta" | "deprecated";
        options: Record<string, any>;
        headers: Record<string, string>;
        release_date: string;
        variants?: Record<string, Record<string, any>> | undefined;
    }>;
    function getLanguage(model: Model): Promise<LanguageModelV2>;
    function closest(providerID: string, query: string[]): Promise<{
        providerID: string;
        modelID: string;
    } | undefined>;
    function getSmallModel(providerID: string): Promise<{
        id: string;
        providerID: string;
        api: {
            id: string;
            url: string;
            npm: string;
        };
        name: string;
        family?: string | undefined;
        capabilities: {
            temperature: boolean;
            reasoning: boolean;
            attachment: boolean;
            toolcall: boolean;
            input: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            output: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            interleaved: boolean | {
                field: "reasoning_content" | "reasoning_details";
            };
        };
        cost: {
            input: number;
            output: number;
            cache: {
                read: number;
                write: number;
            };
            experimentalOver200K?: {
                input: number;
                output: number;
                cache: {
                    read: number;
                    write: number;
                };
            } | undefined;
        };
        limit: {
            context: number;
            input?: number | undefined;
            output: number;
        };
        status: "active" | "alpha" | "beta" | "deprecated";
        options: Record<string, any>;
        headers: Record<string, string>;
        release_date: string;
        variants?: Record<string, Record<string, any>> | undefined;
    } | undefined>;
    function sort(models: Model[]): {
        id: string;
        providerID: string;
        api: {
            id: string;
            url: string;
            npm: string;
        };
        name: string;
        family?: string | undefined;
        capabilities: {
            temperature: boolean;
            reasoning: boolean;
            attachment: boolean;
            toolcall: boolean;
            input: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            output: {
                text: boolean;
                audio: boolean;
                image: boolean;
                video: boolean;
                pdf: boolean;
            };
            interleaved: boolean | {
                field: "reasoning_content" | "reasoning_details";
            };
        };
        cost: {
            input: number;
            output: number;
            cache: {
                read: number;
                write: number;
            };
            experimentalOver200K?: {
                input: number;
                output: number;
                cache: {
                    read: number;
                    write: number;
                };
            } | undefined;
        };
        limit: {
            context: number;
            input?: number | undefined;
            output: number;
        };
        status: "active" | "alpha" | "beta" | "deprecated";
        options: Record<string, any>;
        headers: Record<string, string>;
        release_date: string;
        variants?: Record<string, Record<string, any>> | undefined;
    }[];
    function defaultModel(): Promise<{
        providerID: string;
        modelID: string;
    }>;
    function parseModel(model: string): {
        providerID: string;
        modelID: string;
    };
    const ModelNotFoundError: {
        new (data: {
            providerID: string;
            modelID: string;
            suggestions?: string[] | undefined;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderModelNotFoundError";
            readonly data: {
                providerID: string;
                modelID: string;
                suggestions?: string[] | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderModelNotFoundError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                    modelID: z.ZodString;
                    suggestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderModelNotFoundError";
                data: {
                    providerID: string;
                    modelID: string;
                    suggestions?: string[] | undefined;
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
            name: z.ZodLiteral<"ProviderModelNotFoundError">;
            data: z.ZodObject<{
                providerID: z.ZodString;
                modelID: z.ZodString;
                suggestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderModelNotFoundError";
            readonly data: {
                providerID: string;
                modelID: string;
                suggestions?: string[] | undefined;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderModelNotFoundError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                    modelID: z.ZodString;
                    suggestions: z.ZodOptional<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderModelNotFoundError";
                data: {
                    providerID: string;
                    modelID: string;
                    suggestions?: string[] | undefined;
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
    const InitError: {
        new (data: {
            providerID: string;
        }, options?: ErrorOptions | undefined): {
            cause?: unknown;
            readonly name: "ProviderInitError";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderInitError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderInitError";
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
            name: z.ZodLiteral<"ProviderInitError">;
            data: z.ZodObject<{
                providerID: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
        isInstance(input: any): input is {
            cause?: unknown;
            readonly name: "ProviderInitError";
            readonly data: {
                providerID: string;
            };
            schema(): z.ZodObject<{
                name: z.ZodLiteral<"ProviderInitError">;
                data: z.ZodObject<{
                    providerID: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>;
            toObject(): {
                name: "ProviderInitError";
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
}
