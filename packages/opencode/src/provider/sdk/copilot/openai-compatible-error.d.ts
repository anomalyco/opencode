import { z, type ZodType } from "zod/v4";
export declare const openaiCompatibleErrorDataSchema: z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        param: z.ZodOptional<z.ZodNullable<z.ZodAny>>;
        code: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type OpenAICompatibleErrorData = z.infer<typeof openaiCompatibleErrorDataSchema>;
export type ProviderErrorStructure<T> = {
    errorSchema: ZodType<T>;
    errorToMessage: (error: T) => string;
    isRetryable?: (response: Response, error?: T) => boolean;
};
export declare const defaultOpenAICompatibleErrorStructure: ProviderErrorStructure<OpenAICompatibleErrorData>;
