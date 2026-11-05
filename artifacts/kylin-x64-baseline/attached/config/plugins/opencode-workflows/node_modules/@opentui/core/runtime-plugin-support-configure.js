import { plugin as registerBunPlugin } from "bun";
import { createRuntimePlugin } from "./runtime-plugin.js";
const runtimePluginSupportInstalledKey = "__opentuiCoreRuntimePluginSupportInstalled__";
function normalizeRewriteKey(rewrite) {
    return `${rewrite?.nodeModulesRuntimeSpecifiers ?? true}:${rewrite?.nodeModulesBareSpecifiers ?? false}`;
}
function assertCompatibleInstall(install, options) {
    for (const specifier of Object.keys(options.additional ?? {})) {
        if (!install.additionalSpecifiers.has(specifier)) {
            throw new Error(`OpenTUI Core runtime plugin support is already installed without ${specifier}. Call ensureRuntimePluginSupport({ additional }) from @opentui/core/runtime-plugin-support/configure before importing @opentui/core/runtime-plugin-support.`);
        }
    }
    if (options.core && options.core !== install.core) {
        throw new Error("OpenTUI Core runtime plugin support is already installed with a different core runtime module.");
    }
    if (options.rewrite && normalizeRewriteKey(options.rewrite) !== install.rewriteKey) {
        throw new Error("OpenTUI Core runtime plugin support is already installed with different rewrite options.");
    }
}
export function ensureRuntimePluginSupport(options = {}) {
    const state = globalThis;
    const install = state[runtimePluginSupportInstalledKey];
    if (install) {
        assertCompatibleInstall(install, options);
        return false;
    }
    registerBunPlugin(createRuntimePlugin(options));
    state[runtimePluginSupportInstalledKey] = {
        additionalSpecifiers: new Set(Object.keys(options.additional ?? {})),
        core: options.core,
        rewriteKey: normalizeRewriteKey(options.rewrite),
    };
    return true;
}
export { createRuntimePlugin, runtimeModuleIdForSpecifier } from "./runtime-plugin.js";
//# sourceMappingURL=runtime-plugin-support-configure.js.map