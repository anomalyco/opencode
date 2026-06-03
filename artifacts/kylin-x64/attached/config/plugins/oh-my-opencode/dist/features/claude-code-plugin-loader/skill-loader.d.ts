import type { CommandDefinition } from "../claude-code-command-loader/types";
import type { LoadedPlugin } from "./types";
export declare function loadPluginSkillsAsCommands(plugins: LoadedPlugin[]): Record<string, CommandDefinition>;
