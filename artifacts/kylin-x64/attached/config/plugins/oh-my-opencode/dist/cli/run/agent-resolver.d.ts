import type { RunOptions } from "./types";
import type { OhMyOpenCodeConfig } from "../../config";
type EnvVars = Record<string, string | undefined>;
export declare const resolveRunAgent: (options: RunOptions, pluginConfig: OhMyOpenCodeConfig, env?: EnvVars) => string;
export {};
