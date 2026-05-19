import type { AsyncParsePluginContext } from './context/async-parser';
import type { DeserializePluginContext } from './context/deserializer';
import type { SerializePluginContext } from './context/serializer';
import type { StreamParsePluginContext, SyncParsePluginContext } from './context/sync-parser';
import type { SerovalNode } from './types';
export declare const enum SerovalMode {
    Vanilla = 1,
    Cross = 2
}
export interface PluginData {
    id: number;
}
export type PluginInfo = {
    [key: string]: SerovalNode;
};
export interface Plugin<Value, Info extends PluginInfo> {
    /**
     * A unique string that helps idenfity the plugin
     */
    tag: string;
    /**
     * List of dependency plugins
     */
    extends?: Plugin<any, any>[];
    /**
     * Method to test if a value is an expected value of the plugin
     * @param value
     */
    test(value: unknown): boolean;
    /**
     * Parsing modes
     */
    parse: {
        sync?: (value: Value, ctx: SyncParsePluginContext, data: PluginData) => Info;
        async?: (value: Value, ctx: AsyncParsePluginContext, data: PluginData) => Promise<Info>;
        stream?: (value: Value, ctx: StreamParsePluginContext, data: PluginData) => Info;
    };
    /**
     * Convert the parsed node into a JS string
     */
    serialize(node: Info, ctx: SerializePluginContext, data: PluginData): string;
    /**
     * Convert the parsed node into its runtime equivalent.
     */
    deserialize(node: Info, ctx: DeserializePluginContext, data: PluginData): Value;
}
export declare function createPlugin<Value, Info extends PluginInfo>(plugin: Plugin<Value, Info>): Plugin<Value, Info>;
export interface PluginAccessOptions {
    plugins?: Plugin<any, any>[];
}
export declare function resolvePlugins(plugins?: Plugin<any, any>[]): Plugin<any, any>[] | undefined;
//# sourceMappingURL=plugin.d.ts.map