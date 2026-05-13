import type { ModelMessage } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { JSONSchema } from "zod/v4/core";
import type { Provider } from "./provider";
export declare namespace ProviderTransform {
    const OUTPUT_TOKEN_MAX: any;
    function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>): ModelMessage[];
    function temperature(model: Provider.Model): 0.55 | 0.6 | 1 | undefined;
    function topP(model: Provider.Model): 0.95 | 1 | undefined;
    function topK(model: Provider.Model): 20 | 40 | 64 | undefined;
    function variants(model: Provider.Model): Record<string, Record<string, any>>;
    function options(input: {
        model: Provider.Model;
        sessionID: string;
        providerOptions?: Record<string, any>;
    }): Record<string, any>;
    function smallOptions(model: Provider.Model): {
        store: boolean;
        reasoningEffort: string;
        thinkingConfig?: undefined;
        reasoning?: undefined;
        veniceParameters?: undefined;
    } | {
        store: boolean;
        thinkingConfig?: undefined;
        reasoning?: undefined;
        reasoningEffort?: undefined;
        veniceParameters?: undefined;
    } | {
        store?: undefined;
        thinkingConfig: {
            thinkingLevel: string;
            thinkingBudget?: undefined;
        };
        reasoning?: undefined;
        reasoningEffort?: undefined;
        veniceParameters?: undefined;
    } | {
        store?: undefined;
        thinkingConfig: {
            thinkingLevel?: undefined;
            thinkingBudget: number;
        };
        reasoning?: undefined;
        reasoningEffort?: undefined;
        veniceParameters?: undefined;
    } | {
        store?: undefined;
        thinkingConfig?: undefined;
        reasoning: {
            enabled: boolean;
        };
        reasoningEffort?: undefined;
        veniceParameters?: undefined;
    } | {
        store?: undefined;
        thinkingConfig?: undefined;
        reasoning?: undefined;
        reasoningEffort: string;
        veniceParameters?: undefined;
    } | {
        store?: undefined;
        thinkingConfig?: undefined;
        reasoning?: undefined;
        reasoningEffort?: undefined;
        veniceParameters: {
            disableThinking: boolean;
        };
    } | {
        store?: undefined;
        thinkingConfig?: undefined;
        reasoning?: undefined;
        reasoningEffort?: undefined;
        veniceParameters?: undefined;
    };
    function providerOptions(model: Provider.Model, options: {
        [x: string]: any;
    }): Record<string, any>;
    function maxOutputTokens(model: Provider.Model): number;
    function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7;
}
