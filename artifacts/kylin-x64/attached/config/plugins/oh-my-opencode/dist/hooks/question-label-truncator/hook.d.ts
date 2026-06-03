export declare function createQuestionLabelTruncatorHook(): {
    "tool.execute.before": (input: {
        tool: string;
    }, output: {
        args: Record<string, unknown>;
    }) => Promise<void>;
};
