import { z } from "zod";
export declare const TaskStatusSchema: z.ZodEnum<{
    pending: "pending";
    in_progress: "in_progress";
    completed: "completed";
    deleted: "deleted";
}>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export declare const TaskObjectSchema: z.ZodObject<{
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
    blocks: z.ZodDefault<z.ZodArray<z.ZodString>>;
    blockedBy: z.ZodDefault<z.ZodArray<z.ZodString>>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    repoURL: z.ZodOptional<z.ZodString>;
    parentID: z.ZodOptional<z.ZodString>;
    threadID: z.ZodString;
}, z.core.$strict>;
export type TaskObject = z.infer<typeof TaskObjectSchema>;
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
    blocks: z.ZodDefault<z.ZodArray<z.ZodString>>;
    blockedBy: z.ZodDefault<z.ZodArray<z.ZodString>>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    repoURL: z.ZodOptional<z.ZodString>;
    parentID: z.ZodOptional<z.ZodString>;
    threadID: z.ZodString;
}, z.core.$strict>;
export type Task = TaskObject;
export declare const TaskCreateInputSchema: z.ZodObject<{
    subject: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    activeForm: z.ZodOptional<z.ZodString>;
    blocks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedBy: z.ZodOptional<z.ZodArray<z.ZodString>>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    repoURL: z.ZodOptional<z.ZodString>;
    parentID: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;
export declare const TaskListInputSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        in_progress: "in_progress";
        completed: "completed";
        deleted: "deleted";
    }>>;
    parentID: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
export declare const TaskGetInputSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type TaskGetInput = z.infer<typeof TaskGetInputSchema>;
export declare const TaskUpdateInputSchema: z.ZodObject<{
    id: z.ZodString;
    subject: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        in_progress: "in_progress";
        completed: "completed";
        deleted: "deleted";
    }>>;
    activeForm: z.ZodOptional<z.ZodString>;
    addBlocks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    addBlockedBy: z.ZodOptional<z.ZodArray<z.ZodString>>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    repoURL: z.ZodOptional<z.ZodString>;
    parentID: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;
export declare const TaskDeleteInputSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type TaskDeleteInput = z.infer<typeof TaskDeleteInputSchema>;
