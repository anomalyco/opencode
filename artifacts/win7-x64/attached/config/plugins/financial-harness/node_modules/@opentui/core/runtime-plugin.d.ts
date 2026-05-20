import { type BunPlugin } from "bun";
export type RuntimeModuleExports = Record<string, unknown>;
export type RuntimeModuleLoader = () => RuntimeModuleExports | Promise<RuntimeModuleExports>;
export type RuntimeModuleEntry = RuntimeModuleExports | RuntimeModuleLoader;
export interface RuntimePluginRewriteOptions {
    nodeModulesRuntimeSpecifiers?: boolean;
    nodeModulesBareSpecifiers?: boolean;
}
export interface CreateRuntimePluginOptions {
    core?: RuntimeModuleEntry;
    additional?: Record<string, RuntimeModuleEntry>;
    rewrite?: RuntimePluginRewriteOptions;
}
export declare const isCoreRuntimeModuleSpecifier: (specifier: string) => boolean;
export declare const runtimeModuleIdForSpecifier: (specifier: string) => string;
export declare function createRuntimePlugin(input?: CreateRuntimePluginOptions): BunPlugin;
