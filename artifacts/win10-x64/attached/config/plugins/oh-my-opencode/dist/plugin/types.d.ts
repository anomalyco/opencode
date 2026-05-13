import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";
export type PluginContext = Parameters<Plugin>[0];
export type PluginInstance = Awaited<ReturnType<Plugin>>;
type ChatHeadersHook = PluginInstance extends {
    "chat.headers"?: infer T;
} ? T : (input: unknown, output: unknown) => Promise<void>;
export type PluginInterface = Omit<PluginInstance, "experimental.session.compacting" | "chat.headers"> & {
    "chat.headers"?: ChatHeadersHook;
};
export type ToolsRecord = Record<string, ToolDefinition>;
export type TmuxConfig = {
    enabled: boolean;
    layout: "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical";
    main_pane_size: number;
    main_pane_min_width: number;
    agent_pane_min_width: number;
    isolation: "inline" | "window" | "session";
};
export {};
