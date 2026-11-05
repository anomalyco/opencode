import { type CreateRuntimePluginOptions } from "./runtime-plugin.js";
export declare function ensureRuntimePluginSupport(options?: CreateRuntimePluginOptions): boolean;
export { createRuntimePlugin, runtimeModuleIdForSpecifier } from "./runtime-plugin.js";
export type { CreateRuntimePluginOptions, RuntimeModuleEntry, RuntimeModuleExports, RuntimeModuleLoader, } from "./runtime-plugin.js";
