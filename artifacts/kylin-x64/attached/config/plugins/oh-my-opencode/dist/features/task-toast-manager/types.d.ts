import type { ModelSource } from "../../shared/model-resolver";
export type TaskStatus = "running" | "queued" | "completed" | "error";
export interface ModelFallbackInfo {
    model: string;
    type: "user-defined" | "inherited" | "category-default" | "system-default" | "runtime-fallback";
    source?: ModelSource;
}
export interface TrackedTask {
    id: string;
    sessionID?: string;
    description: string;
    agent: string;
    status: TaskStatus;
    startedAt: Date;
    isBackground: boolean;
    category?: string;
    skills?: string[];
    modelInfo?: ModelFallbackInfo;
}
export interface TaskToastOptions {
    title: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number;
}
