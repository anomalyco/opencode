import z from "zod";
import { Tool } from "./tool";
export declare const CodeSearchTool: Tool.Info<z.ZodObject<{
    query: z.ZodString;
    tokensNum: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, {}>;
