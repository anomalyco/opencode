export declare function createTodoDescriptionOverrideHook(): {
    "tool.definition": (input: {
        toolID: string;
    }, output: {
        description: string;
        parameters: unknown;
    }) => Promise<void>;
};
