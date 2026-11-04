import { type RuntimeModuleEntry, type RuntimePluginRewriteOptions } from "@opentui/core/runtime-plugin";
export interface SolidRuntimePluginSupportOptions {
    additional?: Record<string, RuntimeModuleEntry>;
    core?: RuntimeModuleEntry;
    rewrite?: RuntimePluginRewriteOptions;
}
export declare function ensureRuntimePluginSupport(options?: SolidRuntimePluginSupportOptions): boolean;
