import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<{
    pending: "pending";
    in_progress: "in_progress";
    completed: "completed";
    deleted: "deleted";
}>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    subject: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        in_progress: "in_progress";
        completed: "completed";
        deleted: "deleted";
    }>;
    activeForm: z.ZodOptional<z.ZodString>;
    blocks: z.ZodArray<z.ZodString>;
    blockedBy: z.ZodArray<z.ZodString>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export type Task = z.infer<typeof TaskSchema>;
