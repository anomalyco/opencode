import type { PluginInput } from "@opencode-ai/plugin";
import type { Task } from "../../features/claude-tasks/types.ts";
export interface TodoInfo {
    id?: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "low" | "medium" | "high";
}
type TodoWriter = (input: {
    sessionID: string;
    todos: TodoInfo[];
}) => Promise<void>;
export declare function syncTaskToTodo(task: Task): TodoInfo | null;
export declare function syncTaskTodoUpdate(ctx: PluginInput | undefined, task: Task, sessionID: string, writer?: TodoWriter): Promise<void>;
export declare function syncAllTasksToTodos(ctx: PluginInput, tasks: Task[], sessionID?: string, writer?: TodoWriter): Promise<void>;
export {};
