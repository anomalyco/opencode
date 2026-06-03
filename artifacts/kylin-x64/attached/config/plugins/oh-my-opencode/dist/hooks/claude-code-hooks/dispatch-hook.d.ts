import type { HookAction } from "./types";
import type { CommandResult } from "../../shared/command-executor/execute-hook-command";
export declare function getHookIdentifier(hook: HookAction): string;
export declare function dispatchHook(hook: HookAction, stdinJson: string, cwd: string): Promise<CommandResult>;
