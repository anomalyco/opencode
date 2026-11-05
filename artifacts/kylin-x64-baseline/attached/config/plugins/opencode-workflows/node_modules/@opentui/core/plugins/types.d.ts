import type { CliRenderer } from "../renderer.js";
export type PluginContext = object;
export type SlotMode = "append" | "replace" | "single_winner";
export type PluginErrorPhase = "setup" | "render" | "dispose" | "error_placeholder";
export type PluginErrorSource = "registry" | "core" | (string & {});
export interface PluginErrorEvent {
    pluginId: string;
    slot?: string;
    phase: PluginErrorPhase;
    source: PluginErrorSource;
    error: Error;
    timestamp: number;
}
export interface PluginErrorReport {
    pluginId: string;
    slot?: string;
    phase: PluginErrorPhase;
    source?: PluginErrorSource;
    error: unknown;
}
export type SlotRenderer<TNode, TProps, TContext extends PluginContext = PluginContext> = (ctx: Readonly<TContext>, props: TProps) => TNode;
export interface Plugin<TNode, TSlots extends object, TContext extends PluginContext = PluginContext> {
    id: string;
    order?: number;
    setup?: (ctx: Readonly<TContext>, renderer: CliRenderer) => void;
    dispose?: () => void;
    slots: {
        [K in keyof TSlots]?: SlotRenderer<TNode, TSlots[K], TContext>;
    };
}
export interface ResolvedSlotRenderer<TNode, TProps, TContext extends PluginContext = PluginContext> {
    id: string;
    renderer: SlotRenderer<TNode, TProps, TContext>;
}
