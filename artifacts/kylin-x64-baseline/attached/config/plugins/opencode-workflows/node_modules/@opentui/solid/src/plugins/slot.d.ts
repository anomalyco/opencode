import { SlotRegistry, type CliRenderer, type Plugin, type PluginContext, type PluginErrorEvent, type SlotMode, type SlotRegistryOptions } from "@opentui/core";
import { type JSX } from "solid-js";
export type { SlotMode };
type SlotMap = Record<string, object>;
export type SolidPlugin<TSlots extends SlotMap, TContext extends PluginContext = PluginContext> = Plugin<JSX.Element, TSlots, TContext>;
export type SolidSlotProps<TSlots extends SlotMap, K extends keyof TSlots, TContext extends PluginContext = PluginContext> = {
    registry: SlotRegistry<JSX.Element, TSlots, TContext>;
    name: K;
    mode?: SlotMode;
    children?: JSX.Element;
    pluginFailurePlaceholder?: (failure: PluginErrorEvent) => JSX.Element;
} & TSlots[K];
export type SolidBoundSlotProps<TSlots extends SlotMap, K extends keyof TSlots> = {
    name: K;
    mode?: SlotMode;
    children?: JSX.Element;
} & TSlots[K];
export type SolidRegistrySlotComponent<TSlots extends SlotMap, TContext extends PluginContext = PluginContext> = <K extends keyof TSlots>(props: SolidSlotProps<TSlots, K, TContext>) => JSX.Element;
export type SolidSlotComponent<TSlots extends SlotMap> = <K extends keyof TSlots>(props: SolidBoundSlotProps<TSlots, K>) => JSX.Element;
export interface SolidSlotOptions {
    pluginFailurePlaceholder?: (failure: PluginErrorEvent) => JSX.Element;
}
export declare function createSolidSlotRegistry<TSlots extends SlotMap, TContext extends PluginContext = PluginContext>(renderer: CliRenderer, context: TContext, options?: SlotRegistryOptions): SlotRegistry<JSX.Element, TSlots, TContext>;
export declare function createSlot<TSlots extends SlotMap, TContext extends PluginContext = PluginContext>(registry: SlotRegistry<JSX.Element, TSlots, TContext>, options?: SolidSlotOptions): SolidSlotComponent<TSlots>;
export declare function Slot<TSlots extends SlotMap, TContext extends PluginContext = PluginContext, K extends keyof TSlots = keyof TSlots>(props: SolidSlotProps<TSlots, K, TContext>): JSX.Element;
