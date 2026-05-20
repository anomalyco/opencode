import type { PluginInput } from "@opencode-ai/plugin";
interface HashlineReadEnhancerConfig {
    hashline_edit?: {
        enabled: boolean;
    };
}
export declare function createHashlineReadEnhancerHook(_ctx: PluginInput, config: HashlineReadEnhancerConfig): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
export {};
