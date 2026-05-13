import type { TodoFile } from "./types";
export declare function getTodoPath(sessionId: string): string;
export interface OpenCodeTodo {
    content: string;
    status: string;
    priority: string;
    id: string;
}
export declare function loadTodoFile(sessionId: string): TodoFile | null;
export declare function saveTodoFile(sessionId: string, file: TodoFile): void;
export declare function saveOpenCodeTodos(sessionId: string, todos: OpenCodeTodo[]): void;
export declare function deleteTodoFile(sessionId: string): void;
