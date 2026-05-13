import z from "zod";
import { Tool } from "./tool";
export declare const TodoWriteTool: Tool.Info<z.ZodObject<{
    todos: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        status: z.ZodString;
        priority: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, {
    todos: {
        content: string;
        status: string;
        priority: string;
    }[];
}>;
export declare const TodoReadTool: Tool.Info<z.ZodObject<{}, z.core.$strip>, {
    todos: {
        content: any;
        status: any;
        priority: any;
    }[];
}>;
