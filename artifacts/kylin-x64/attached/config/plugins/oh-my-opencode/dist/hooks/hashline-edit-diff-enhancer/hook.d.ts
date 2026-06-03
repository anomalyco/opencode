interface HashlineEditDiffEnhancerConfig {
    hashline_edit?: {
        enabled: boolean;
    };
}
type BeforeInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type BeforeOutput = {
    args: Record<string, unknown>;
};
type AfterInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type AfterOutput = {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
};
export declare function createHashlineEditDiffEnhancerHook(config: HashlineEditDiffEnhancerConfig): {
    "tool.execute.before": (input: BeforeInput, output: BeforeOutput) => Promise<void>;
    "tool.execute.after": (input: AfterInput, output: AfterOutput) => Promise<void>;
};
export {};
