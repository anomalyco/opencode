import type { CheckResult, SystemInfo } from "../types";
import { findOpenCodeBinary, getOpenCodeVersion, compareVersions } from "./system-binary";
import { getPluginInfo } from "./system-plugin";
import { getLatestPluginVersion, getLoadedPluginVersion, getSuggestedInstallTag } from "./system-loaded-version";
interface SystemCheckDeps {
    findOpenCodeBinary: typeof findOpenCodeBinary;
    getOpenCodeVersion: typeof getOpenCodeVersion;
    compareVersions: typeof compareVersions;
    getPluginInfo: typeof getPluginInfo;
    getLoadedPluginVersion: typeof getLoadedPluginVersion;
    getLatestPluginVersion: typeof getLatestPluginVersion;
    getSuggestedInstallTag: typeof getSuggestedInstallTag;
}
export declare function gatherSystemInfo(deps?: SystemCheckDeps): Promise<SystemInfo>;
export declare function checkSystem(deps?: SystemCheckDeps): Promise<CheckResult>;
export {};
