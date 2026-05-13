export type PluginDispose = () => Promise<void>;
export declare function createPluginDispose(args: {
    backgroundManager: {
        shutdown: () => void | Promise<void>;
    };
    skillMcpManager: {
        disconnectAll: () => Promise<void>;
    };
    lspManager: {
        stopAll: () => Promise<void>;
    };
    disposeHooks: () => void;
}): PluginDispose;
