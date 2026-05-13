import z from "zod";
import { Tool } from "./tool";
export declare const GrepTool: Tool.Info<z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    include: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, {
    matches: number;
    truncated: boolean;
}>;
