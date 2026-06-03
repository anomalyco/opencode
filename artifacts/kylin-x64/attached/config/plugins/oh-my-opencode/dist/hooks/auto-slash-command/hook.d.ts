import type { AutoSlashCommandHookInput, AutoSlashCommandHookOutput, CommandExecuteBeforeInput, CommandExecuteBeforeOutput } from "./types";
import type { LoadedSkill } from "../../features/opencode-skill-loader";
export interface AutoSlashCommandHookOptions {
    skills?: LoadedSkill[];
    pluginsEnabled?: boolean;
    enabledPluginsOverride?: Record<string, boolean>;
    directory?: string;
}
export declare function createAutoSlashCommandHook(options?: AutoSlashCommandHookOptions): {
    "chat.message": (input: AutoSlashCommandHookInput, output: AutoSlashCommandHookOutput) => Promise<void>;
    "command.execute.before": (input: CommandExecuteBeforeInput, output: CommandExecuteBeforeOutput) => Promise<void>;
    event: ({ event, }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    dispose: () => void;
};
