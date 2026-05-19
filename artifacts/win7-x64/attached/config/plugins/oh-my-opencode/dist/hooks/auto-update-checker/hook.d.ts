import type { PluginInput } from "@opencode-ai/plugin";
import { log } from "../../shared/logger";
import type { AutoUpdateCheckerOptions } from "./types";
import { getCachedVersion, getLocalDevVersion } from "./checker";
import { runBackgroundUpdateCheck } from "./hook/background-update-check";
import { showConfigErrorsIfAny } from "./hook/config-errors-toast";
import { updateAndShowConnectedProvidersCacheStatus } from "./hook/connected-providers-status";
import { refreshModelCapabilitiesOnStartup } from "./hook/model-capabilities-status";
import { showModelCacheWarningIfNeeded } from "./hook/model-cache-warning";
import { showLocalDevToast, showVersionToast } from "./hook/startup-toasts";
interface AutoUpdateCheckerDeps {
    getCachedVersion: typeof getCachedVersion;
    getLocalDevVersion: typeof getLocalDevVersion;
    showConfigErrorsIfAny: typeof showConfigErrorsIfAny;
    updateAndShowConnectedProvidersCacheStatus: typeof updateAndShowConnectedProvidersCacheStatus;
    refreshModelCapabilitiesOnStartup: typeof refreshModelCapabilitiesOnStartup;
    showModelCacheWarningIfNeeded: typeof showModelCacheWarningIfNeeded;
    showLocalDevToast: typeof showLocalDevToast;
    showVersionToast: typeof showVersionToast;
    runBackgroundUpdateCheck: typeof runBackgroundUpdateCheck;
    log: typeof log;
}
export declare function createAutoUpdateCheckerHook(ctx: PluginInput, options?: AutoUpdateCheckerOptions, deps?: AutoUpdateCheckerDeps): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => void;
};
export {};
