import z from "zod";
import { Tool } from "./tool";
export declare const WebSearchTool: Tool.Info<z.ZodObject<{
    query: z.ZodString;
    numResults: z.ZodOptional<z.ZodNumber>;
    livecrawl: z.ZodOptional<z.ZodEnum<{
        fallback: "fallback";
        preferred: "preferred";
    }>>;
    type: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        deep: "deep";
        fast: "fast";
    }>>;
    contextMaxCharacters: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, {}>;
