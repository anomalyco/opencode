import { z } from "zod";
export declare const FallbackModelObjectSchema: z.ZodObject<{
    model: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FallbackModelObject = z.infer<typeof FallbackModelObjectSchema>;
export declare const FallbackModelStringArraySchema: z.ZodArray<z.ZodString>;
export declare const FallbackModelObjectArraySchema: z.ZodArray<z.ZodObject<{
    model: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>>;
export declare const FallbackModelMixedArraySchema: z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    model: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>]>>;
export declare const FallbackModelsSchema: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>, z.ZodArray<z.ZodObject<{
    model: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>>, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    model: z.ZodString;
    variant: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        none: "none";
        minimal: "minimal";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
    }>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>]>>]>;
export type FallbackModels = z.infer<typeof FallbackModelsSchema>;
