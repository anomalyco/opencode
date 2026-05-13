import z from "zod";
export declare namespace ModelsDev {
    const Model: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        family: z.ZodOptional<z.ZodString>;
        release_date: z.ZodString;
        attachment: z.ZodBoolean;
        reasoning: z.ZodBoolean;
        temperature: z.ZodBoolean;
        tool_call: z.ZodBoolean;
        interleaved: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodObject<{
            field: z.ZodEnum<{
                reasoning_content: "reasoning_content";
                reasoning_details: "reasoning_details";
            }>;
        }, z.core.$strict>]>>;
        cost: z.ZodOptional<z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            cache_read: z.ZodOptional<z.ZodNumber>;
            cache_write: z.ZodOptional<z.ZodNumber>;
            context_over_200k: z.ZodOptional<z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cache_read: z.ZodOptional<z.ZodNumber>;
                cache_write: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        limit: z.ZodObject<{
            context: z.ZodNumber;
            input: z.ZodOptional<z.ZodNumber>;
            output: z.ZodNumber;
        }, z.core.$strip>;
        modalities: z.ZodOptional<z.ZodObject<{
            input: z.ZodArray<z.ZodEnum<{
                audio: "audio";
                image: "image";
                pdf: "pdf";
                text: "text";
                video: "video";
            }>>;
            output: z.ZodArray<z.ZodEnum<{
                audio: "audio";
                image: "image";
                pdf: "pdf";
                text: "text";
                video: "video";
            }>>;
        }, z.core.$strip>>;
        experimental: z.ZodOptional<z.ZodBoolean>;
        status: z.ZodOptional<z.ZodEnum<{
            alpha: "alpha";
            beta: "beta";
            deprecated: "deprecated";
        }>>;
        options: z.ZodRecord<z.ZodString, z.ZodAny>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        provider: z.ZodOptional<z.ZodObject<{
            npm: z.ZodOptional<z.ZodString>;
            api: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>>>;
    }, z.core.$strip>;
    type Model = z.infer<typeof Model>;
    const Provider: z.ZodObject<{
        api: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        env: z.ZodArray<z.ZodString>;
        id: z.ZodString;
        npm: z.ZodOptional<z.ZodString>;
        models: z.ZodRecord<z.ZodString, z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            family: z.ZodOptional<z.ZodString>;
            release_date: z.ZodString;
            attachment: z.ZodBoolean;
            reasoning: z.ZodBoolean;
            temperature: z.ZodBoolean;
            tool_call: z.ZodBoolean;
            interleaved: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodObject<{
                field: z.ZodEnum<{
                    reasoning_content: "reasoning_content";
                    reasoning_details: "reasoning_details";
                }>;
            }, z.core.$strict>]>>;
            cost: z.ZodOptional<z.ZodObject<{
                input: z.ZodNumber;
                output: z.ZodNumber;
                cache_read: z.ZodOptional<z.ZodNumber>;
                cache_write: z.ZodOptional<z.ZodNumber>;
                context_over_200k: z.ZodOptional<z.ZodObject<{
                    input: z.ZodNumber;
                    output: z.ZodNumber;
                    cache_read: z.ZodOptional<z.ZodNumber>;
                    cache_write: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            limit: z.ZodObject<{
                context: z.ZodNumber;
                input: z.ZodOptional<z.ZodNumber>;
                output: z.ZodNumber;
            }, z.core.$strip>;
            modalities: z.ZodOptional<z.ZodObject<{
                input: z.ZodArray<z.ZodEnum<{
                    audio: "audio";
                    image: "image";
                    pdf: "pdf";
                    text: "text";
                    video: "video";
                }>>;
                output: z.ZodArray<z.ZodEnum<{
                    audio: "audio";
                    image: "image";
                    pdf: "pdf";
                    text: "text";
                    video: "video";
                }>>;
            }, z.core.$strip>>;
            experimental: z.ZodOptional<z.ZodBoolean>;
            status: z.ZodOptional<z.ZodEnum<{
                alpha: "alpha";
                beta: "beta";
                deprecated: "deprecated";
            }>>;
            options: z.ZodRecord<z.ZodString, z.ZodAny>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            provider: z.ZodOptional<z.ZodObject<{
                npm: z.ZodOptional<z.ZodString>;
                api: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            variants: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodAny>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    type Provider = z.infer<typeof Provider>;
    const Data: any;
    function get(): Promise<Record<string, {
        api?: string | undefined;
        name: string;
        env: string[];
        id: string;
        npm?: string | undefined;
        models: Record<string, {
            id: string;
            name: string;
            family?: string | undefined;
            release_date: string;
            attachment: boolean;
            reasoning: boolean;
            temperature: boolean;
            tool_call: boolean;
            interleaved?: true | {
                field: "reasoning_content" | "reasoning_details";
            } | undefined;
            cost?: {
                input: number;
                output: number;
                cache_read?: number | undefined;
                cache_write?: number | undefined;
                context_over_200k?: {
                    input: number;
                    output: number;
                    cache_read?: number | undefined;
                    cache_write?: number | undefined;
                } | undefined;
            } | undefined;
            limit: {
                context: number;
                input?: number | undefined;
                output: number;
            };
            modalities?: {
                input: ("audio" | "image" | "pdf" | "text" | "video")[];
                output: ("audio" | "image" | "pdf" | "text" | "video")[];
            } | undefined;
            experimental?: boolean | undefined;
            status?: "alpha" | "beta" | "deprecated" | undefined;
            options: Record<string, any>;
            headers?: Record<string, string> | undefined;
            provider?: {
                npm?: string | undefined;
                api?: string | undefined;
            } | undefined;
            variants?: Record<string, Record<string, any>> | undefined;
        }>;
    }>>;
    function refresh(): Promise<void>;
}
