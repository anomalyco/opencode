import z from "zod";
import { Tool } from "./tool";
export declare const InvalidTool: Tool.Info<z.ZodObject<{
    tool: z.ZodString;
    error: z.ZodString;
}, z.core.$strip>, {}>;
