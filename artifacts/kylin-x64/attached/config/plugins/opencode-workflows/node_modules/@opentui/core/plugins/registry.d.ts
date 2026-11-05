import type { CliRenderer } from "../renderer.js";
import type { Plugin, PluginContext, PluginErrorEvent, PluginErrorReport, ResolvedSlotRenderer, SlotRenderer } from "./types.js";
export interface SlotRegistryOptions {
    onPluginError?: (event: PluginErrorEvent) => void;
    debugPluginErrors?: boolean;
    maxPluginErrors?: number;
}
export declare class SlotRegistry<TNode, TSlots extends object, TContext extends PluginContext = PluginContext> {
    private plugins;
    private sortedPluginsCache;
    private listeners;
    private errorListeners;
    private pluginErrors;
    private registrationOrder;
    private batchDepth;
    private batchedNotify;
    private rendererInstance;
    private hostContext;
    private options;
    constructor(renderer: CliRenderer, context: TContext, options?: SlotRegistryOptions);
    get renderer(): CliRenderer;
    get context(): Readonly<TContext>;
    configure(options: SlotRegistryOptions): void;
    register(plugin: Plugin<TNode, TSlots, TContext>): () => void;
    unregister(id: string): boolean;
    updateOrder(id: string, order: number): boolean;
    clear(): void;
    subscribe(listener: () => void): () => void;
    onPluginError(listener: (event: PluginErrorEvent) => void): () => void;
    batch<T>(run: () => T): T;
    getPluginErrors(): readonly PluginErrorEvent[];
    clearPluginErrors(): void;
    reportPluginError(report: PluginErrorReport): PluginErrorEvent;
    resolve<K extends keyof TSlots>(slot: K): Array<SlotRenderer<TNode, TSlots[K], TContext>>;
    resolveEntries<K extends keyof TSlots>(slot: K): Array<ResolvedSlotRenderer<TNode, TSlots[K], TContext>>;
    private getSortedPlugins;
    private syncPluginSortMetadata;
    private invalidateSortedPluginsCache;
    private notifyListeners;
    private flushListeners;
}
export declare function createSlotRegistry<TNode, TSlots extends object, TContext extends PluginContext = PluginContext>(renderer: CliRenderer, key: string, context: TContext, options?: SlotRegistryOptions): SlotRegistry<TNode, TSlots, TContext>;
