import { type BunPlugin } from "bun";
import { type ResolveImportPath } from "./solid-transform.js";
export interface CreateSolidTransformPluginOptions {
    moduleName?: string;
    resolvePath?: ResolveImportPath;
}
export declare function ensureSolidTransformPlugin(input?: CreateSolidTransformPluginOptions): boolean;
export declare function resetSolidTransformPluginState(): void;
export declare function createSolidTransformPlugin(input?: CreateSolidTransformPluginOptions): BunPlugin;
declare const solidTransformPlugin: BunPlugin;
export default solidTransformPlugin;
