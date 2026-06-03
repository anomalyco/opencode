import type { PluginInput } from "@opencode-ai/plugin";
export type MockLastAssistant = {
    info: {
        summary?: boolean;
        providerID: string;
        modelID: string;
    };
    hasContent: boolean;
};
export declare const executeCompactMock: import("bun:test").Mock<typeof import("./executor").executeCompact>;
export declare const getLastAssistantMock: import("bun:test").Mock<typeof import("./message-builder").getLastAssistant>;
export declare const parseAnthropicTokenLimitErrorMock: import("bun:test").Mock<typeof import("./parser").parseAnthropicTokenLimitError>;
export declare function createRecoveryHook(): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    dispose: () => void;
};
export declare function createMockContext(): PluginInput;
export declare function setupDelayedTimeoutMocks(): {
    createUntrackedTimeout: () => ReturnType<typeof setTimeout>;
    runScheduledTimeout: (index: number) => void;
    restore: () => void;
    getClearTimeoutCalls: () => Array<ReturnType<typeof setTimeout>>;
    getScheduledTimeouts: () => Array<ReturnType<typeof setTimeout>>;
};
