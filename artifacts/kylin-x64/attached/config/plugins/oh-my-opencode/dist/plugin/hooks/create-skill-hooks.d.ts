import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder";
import type { HookName, OhMyOpenCodeConfig } from "../../config";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
import type { PluginContext } from "../types";
import { createAutoSlashCommandHook, createCategorySkillReminderHook } from "../../hooks";
export type SkillHooks = {
    categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null;
    autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null;
};
export declare function createSkillHooks(args: {
    ctx: PluginContext;
    pluginConfig: OhMyOpenCodeConfig;
    isHookEnabled: (hookName: HookName) => boolean;
    safeHookEnabled: boolean;
    mergedSkills: LoadedSkill[];
    availableSkills: AvailableSkill[];
}): SkillHooks;
