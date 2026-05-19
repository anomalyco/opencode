import type { PluginInstallation } from "./types";
export declare function shouldLoadPluginForCwd(installation: Pick<PluginInstallation, "scope" | "projectPath">, cwd?: string): boolean;
