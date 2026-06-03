import type { CommandDefinition } from "../claude-code-command-loader/types";
import type { LoadedPlugin } from "./types";
export declare function loadPluginCommands(plugins: LoadedPlugin[]): Record<string, CommandDefinition>;
