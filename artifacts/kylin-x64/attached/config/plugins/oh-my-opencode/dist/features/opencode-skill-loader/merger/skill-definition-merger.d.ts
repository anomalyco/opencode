import type { LoadedSkill } from "../types";
import type { SkillDefinition } from "../../../config/schema";
export declare function mergeSkillDefinitions(base: LoadedSkill, patch: SkillDefinition): LoadedSkill;
