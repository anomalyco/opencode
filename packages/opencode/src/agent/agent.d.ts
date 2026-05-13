import z from "zod";
export declare namespace Agent {
    const Info: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        mode: z.ZodEnum<{
            all: "all";
            primary: "primary";
            subagent: "subagent";
        }>;
        native: z.ZodOptional<z.ZodBoolean>;
        hidden: z.ZodOptional<z.ZodBoolean>;
        topP: z.ZodOptional<z.ZodNumber>;
        temperature: z.ZodOptional<z.ZodNumber>;
        color: z.ZodOptional<z.ZodString>;
        permission: any;
        model: z.ZodOptional<z.ZodObject<{
            modelID: z.ZodString;
            providerID: z.ZodString;
        }, z.core.$strip>>;
        variant: z.ZodOptional<z.ZodString>;
        prompt: z.ZodOptional<z.ZodString>;
        options: z.ZodRecord<z.ZodString, z.ZodAny>;
        steps: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    function get(agent: string): Promise<{
        [x: string]: any;
        name: string;
        description?: string | undefined;
        mode: "all" | "primary" | "subagent";
        native?: boolean | undefined;
        hidden?: boolean | undefined;
        topP?: number | undefined;
        temperature?: number | undefined;
        color?: string | undefined;
        model?: {
            modelID: string;
            providerID: string;
        } | undefined;
        variant?: string | undefined;
        prompt?: string | undefined;
        options: Record<string, any>;
        steps?: number | undefined;
    }>;
    function list(): Promise<{
        [x: string]: any;
        name: string;
        description?: string | undefined;
        mode: "all" | "primary" | "subagent";
        native?: boolean | undefined;
        hidden?: boolean | undefined;
        topP?: number | undefined;
        temperature?: number | undefined;
        color?: string | undefined;
        model?: {
            modelID: string;
            providerID: string;
        } | undefined;
        variant?: string | undefined;
        prompt?: string | undefined;
        options: Record<string, any>;
        steps?: number | undefined;
    }[]>;
    function defaultAgent(): Promise<string>;
    function generate(input: {
        description: string;
        model?: {
            providerID: string;
            modelID: string;
        };
    }): Promise<{
        identifier: string;
        whenToUse: string;
        systemPrompt: string;
    }>;
}
