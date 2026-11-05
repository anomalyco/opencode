import type { AsyncParsePluginContext } from './context/async-parser';
import type { DeserializePluginContext } from './context/deserializer';
import type { SerializePluginContext } from './context/serializer';
import type {
  StreamParsePluginContext,
  SyncParsePluginContext,
} from './context/sync-parser';
import type { SerovalNode } from './types';

export const enum SerovalMode {
  Vanilla = 1,
  Cross = 2,
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
    sync?: (
      value: Value,
      ctx: SyncParsePluginContext,
      data: PluginData,
    ) => Info;
    async?: (
      value: Value,
      ctx: AsyncParsePluginContext,
      data: PluginData,
    ) => Promise<Info>;
    stream?: (
      value: Value,
      ctx: StreamParsePluginContext,
      data: PluginData,
    ) => Info;
  };
  /**
   * Convert the parsed node into a JS string
   */
  serialize(node: Info, ctx: SerializePluginContext, data: PluginData): string;
  /**
   * Convert the parsed node into its runtime equivalent.
   */
  deserialize(
    node: Info,
    ctx: DeserializePluginContext,
    data: PluginData,
  ): Value;
}

export function createPlugin<Value, Info extends PluginInfo>(
  plugin: Plugin<Value, Info>,
): Plugin<Value, Info> {
  return plugin;
}

export interface PluginAccessOptions {
  plugins?: Plugin<any, any>[];
}

function dedupePlugins(
  deduped: Set<Plugin<any, any>>,
  plugins: Plugin<any, any>[],
): void {
  for (let i = 0, len = plugins.length; i < len; i++) {
    const current = plugins[i];
    if (!deduped.has(current)) {
      deduped.add(current);
      if (current.extends) {
        dedupePlugins(deduped, current.extends);
      }
    }
  }
}

export function resolvePlugins(
  plugins?: Plugin<any, any>[],
): Plugin<any, any>[] | undefined {
  if (plugins) {
    const deduped = new Set<Plugin<any, any>>();
    dedupePlugins(deduped, plugins);
    return [...deduped];
  }
  return undefined;
}
