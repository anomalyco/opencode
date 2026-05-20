export interface TasksTodowriteDisablerConfig {
    experimental?: {
        task_system?: boolean;
    };
}
export declare function createTasksTodowriteDisablerHook(config: TasksTodowriteDisablerConfig): {
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, _output: {
        args: Record<string, unknown>;
    }) => Promise<void>;
};
