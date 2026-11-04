import { plugin as registerBunPlugin } from "bun";
import { stripQueryAndHash, transformSolidSource } from "./solid-transform.js";
const solidTransformStateKey = Symbol.for("opentui.solid.transform");
const getSolidTransformState = () => {
    const state = globalThis;
    state[solidTransformStateKey] ??= { installed: false };
    return state[solidTransformStateKey];
};
const getSolidTransformRuntime = () => {
    return getSolidTransformState().runtime ?? {};
};
const hasSolidTransformRuntime = (input) => {
    return input.moduleName !== undefined || input.resolvePath !== undefined;
};
export function ensureSolidTransformPlugin(input = {}) {
    const state = getSolidTransformState();
    if (hasSolidTransformRuntime(input)) {
        state.runtime = {
            moduleName: input.moduleName,
            resolvePath: input.resolvePath,
        };
    }
    if (state.installed) {
        return false;
    }
    registerBunPlugin(createSolidTransformPlugin());
    state.installed = true;
    return true;
}
export function resetSolidTransformPluginState() {
    const state = getSolidTransformState();
    state.installed = false;
    delete state.runtime;
}
export function createSolidTransformPlugin(input = {}) {
    const sourceFilter = input.resolvePath
        ? /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?(?:[?#].*)?$/
        : /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/;
    return {
        name: "bun-plugin-solid",
        setup: (build) => {
            build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, async (args) => {
                const path = stripQueryAndHash(args.path).replace("server.js", "solid.js");
                const file = Bun.file(path);
                const code = await file.text();
                return { contents: code, loader: "js" };
            });
            build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, async (args) => {
                const path = stripQueryAndHash(args.path).replace("server.js", "store.js");
                const file = Bun.file(path);
                const code = await file.text();
                return { contents: code, loader: "js" };
            });
            build.onLoad({ filter: sourceFilter }, async (args) => {
                const path = stripQueryAndHash(args.path);
                const file = Bun.file(path);
                const code = await file.text();
                const runtime = getSolidTransformRuntime();
                const moduleName = input.moduleName ?? runtime.moduleName ?? "@opentui/solid";
                const resolvePath = input.resolvePath ?? runtime.resolvePath;
                const contents = await transformSolidSource(code, {
                    filename: path,
                    moduleName,
                    resolvePath,
                });
                return {
                    contents,
                    loader: "js",
                };
            });
        },
    };
}
const solidTransformPlugin = createSolidTransformPlugin();
export default solidTransformPlugin;
//# sourceMappingURL=solid-plugin.js.map