import z from "zod";
import { Tool } from "./tool";
export declare const WebFetchTool: Tool.Info<z.ZodObject<{
    url: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<{
        html: "html";
        markdown: "markdown";
        text: "text";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, {}>;
