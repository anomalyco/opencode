import type { LoadedSkill } from "./types";
import type { SkillsConfig } from "../../config/schema";
import type { BuiltinSkill } from "../builtin-skills/types";
export interface MergeSkillsOptions {
    configDir?: string;
}
export declare function mergeSkills(builtinSkills: BuiltinSkill[], config: SkillsConfig | undefined, configSourceSkills: LoadedSkill[], userClaudeSkills: LoadedSkill[], userOpencodeSkills: LoadedSkill[], projectClaudeSkills: LoadedSkill[], projectOpencodeSkills: LoadedSkill[], options?: MergeSkillsOptions): LoadedSkill[];
