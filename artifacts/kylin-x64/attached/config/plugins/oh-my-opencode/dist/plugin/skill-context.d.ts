import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { BrowserAutomationProvider } from "../config/schema/browser-automation";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";
export type SkillContext = {
    mergedSkills: LoadedSkill[];
    availableSkills: AvailableSkill[];
    browserProvider: BrowserAutomationProvider;
    disabledSkills: Set<string>;
};
export declare function createSkillContext(args: {
    directory: string;
    pluginConfig: OhMyOpenCodeConfig;
}): Promise<SkillContext>;
