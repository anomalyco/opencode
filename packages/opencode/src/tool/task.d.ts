import { Tool } from "./tool";
import z from "zod";
export declare const TaskTool: Tool.Info<z.ZodObject<{
    description: z.ZodString;
    prompt: z.ZodString;
    subagent_type: z.ZodString;
    task_id: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, {
    sessionId: any;
    model: {
        modelID: any;
        providerID: any;
    };
}>;
