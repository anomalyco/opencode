import type { PluginInput } from "@opencode-ai/plugin";
import { checkForLegacyPluginEntry } from "../../shared/legacy-plugin-warning";
import { log } from "../../shared/logger";
import { autoMigrateLegacyPluginEntry } from "./auto-migrate-runner";
type LegacyPluginToastDeps = {
    checkForLegacyPluginEntry?: typeof checkForLegacyPluginEntry;
    log?: typeof log;
    autoMigrateLegacyPluginEntry?: typeof autoMigrateLegacyPluginEntry;
};
export declare function createLegacyPluginToastHook(ctx: PluginInput, deps?: LegacyPluginToastDeps): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
export {};
