import { z } from "zod";
export declare const WebsearchProviderSchema: z.ZodEnum<{
    exa: "exa";
    tavily: "tavily";
}>;
export declare const WebsearchConfigSchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        exa: "exa";
        tavily: "tavily";
    }>>;
}, z.core.$strip>;
export type WebsearchProvider = z.infer<typeof WebsearchProviderSchema>;
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>;
