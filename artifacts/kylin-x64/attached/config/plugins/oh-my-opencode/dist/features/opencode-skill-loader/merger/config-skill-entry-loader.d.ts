import type { LoadedSkill } from "../types";
import type { SkillDefinition } from "../../../config/schema";
export declare function configEntryToLoadedSkill(name: string, entry: SkillDefinition, configDir?: string): LoadedSkill | null;
