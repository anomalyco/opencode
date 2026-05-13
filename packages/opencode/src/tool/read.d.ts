import z from "zod";
import { Tool } from "./tool";
export declare const ReadTool: Tool.Info<z.ZodObject<{
    filePath: z.ZodString;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>, {
    preview: string;
    truncated: boolean;
    loaded: string[];
}>;
