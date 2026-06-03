import type { RuntimeFallbackConfig, OhMyOpenCodeConfig } from "../../config";
export interface RuntimeFallbackInterval {
    unref: () => void;
}
export type RuntimeFallbackTimeout = object | number;
export interface RuntimeFallbackPluginInput {
    client: {
        session: {
            abort: (input: {
                path: {
                    id: string;
                };
            }) => Promise<unknown>;
            messages: (input: {
                path: {
                    id: string;
                };
                query: {
                    directory: string;
                };
            }) => Promise<unknown>;
            promptAsync: (input: {
                path: {
                    id: string;
                };
                body: {
                    agent?: string;
                    model: {
                        providerID: string;
                        modelID: string;
                    };
                    parts: Array<{
                        type: "text";
                        text: string;
                    }>;
                };
                query: {
                    directory: string;
                };
            }) => Promise<unknown>;
        };
        tui: {
            showToast: (input: {
                body: {
                    title: string;
                    message: string;
                    variant: "success" | "error" | "info" | "warning";
                    duration: number;
                };
            }) => Promise<unknown>;
        };
    };
    directory: string;
}
export interface FallbackState {
    originalModel: string;
    currentModel: string;
    fallbackIndex: number;
    failedModels: Map<string, number>;
    attemptCount: number;
    pendingFallbackModel?: string;
}
export interface FallbackResult {
    success: boolean;
    newModel?: string;
    error?: string;
    maxAttemptsReached?: boolean;
}
export interface RuntimeFallbackOptions {
    config?: RuntimeFallbackConfig;
    pluginConfig?: OhMyOpenCodeConfig;
    session_timeout_ms?: number;
}
export interface RuntimeFallbackHook {
    event: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    "chat.message"?: (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
    }, output: {
        message: {
            model?: {
                providerID: string;
                modelID: string;
            };
        };
        parts?: Array<{
            type: string;
            text?: string;
        }>;
    }) => Promise<void>;
    dispose?: () => void;
}
export interface HookDeps {
    ctx: RuntimeFallbackPluginInput;
    config: Required<RuntimeFallbackConfig>;
    options: RuntimeFallbackOptions | undefined;
    pluginConfig: OhMyOpenCodeConfig | undefined;
    sessionStates: Map<string, FallbackState>;
    sessionLastAccess: Map<string, number>;
    sessionRetryInFlight: Set<string>;
    sessionAwaitingFallbackResult: Set<string>;
    sessionFallbackTimeouts: Map<string, RuntimeFallbackTimeout>;
    sessionStatusRetryKeys: Map<string, string>;
}
