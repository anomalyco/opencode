import { checkForLegacyPluginEntry } from "./legacy-plugin-warning";
import { log } from "./logger";
import { migrateLegacyPluginEntry } from "./migrate-legacy-plugin-entry";
type LogLegacyPluginStartupWarningDeps = {
    checkForLegacyPluginEntry?: typeof checkForLegacyPluginEntry;
    log?: typeof log;
    migrateLegacyPluginEntry?: typeof migrateLegacyPluginEntry;
};
export declare function logLegacyPluginStartupWarning(deps?: LogLegacyPluginStartupWarningDeps): void;
export {};
