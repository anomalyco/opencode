import z from "zod";
import { Tool } from "./tool";
export declare const BatchTool: Tool.Info<z.ZodObject<{
    tool_calls: z.ZodArray<z.ZodObject<{
        tool: z.ZodString;
        parameters: z.ZodObject<{}, z.core.$loose>;
    }, z.core.$strip>>;
}, z.core.$strip>, {
    totalCalls: number;
    successful: number;
    failed: number;
    tools: string[];
    details: {
        tool: string;
        success: boolean;
    }[];
}>;
