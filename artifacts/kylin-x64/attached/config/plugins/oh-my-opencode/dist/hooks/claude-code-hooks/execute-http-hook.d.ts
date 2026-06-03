import type { HookHttp } from "./types";
import type { CommandResult } from "../../shared/command-executor/execute-hook-command";
export declare function interpolateEnvVars(value: string, allowedEnvVars: string[]): string;
export declare function executeHttpHook(hook: HookHttp, stdin: string): Promise<CommandResult>;
