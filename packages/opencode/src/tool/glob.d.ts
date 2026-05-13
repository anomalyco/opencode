import z from "zod";
import { Tool } from "./tool";
export declare const GlobTool: Tool.Info<z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, {
    count: number;
    truncated: boolean;
}>;
export declare const EmptyGlobTool: Tool.Info<z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, {
    count: number;
    truncated: boolean;
}>;
