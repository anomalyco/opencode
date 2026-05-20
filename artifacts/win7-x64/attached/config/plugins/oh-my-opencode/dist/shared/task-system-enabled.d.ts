export interface TaskSystemConfig {
    experimental?: {
        task_system?: boolean;
    };
}
export declare function isTaskSystemEnabled(config: TaskSystemConfig): boolean;
