import type { PluginManifest, PluginLoadResult, PluginLoaderOptions } from "./types";
export declare function loadPluginManifest(installPath: string): PluginManifest | null;
export declare function discoverInstalledPlugins(options?: PluginLoaderOptions): PluginLoadResult;
