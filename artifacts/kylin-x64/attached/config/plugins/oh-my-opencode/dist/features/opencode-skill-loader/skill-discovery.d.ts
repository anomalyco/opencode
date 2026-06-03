import type { LoadedSkill } from "./types";
import type { SkillResolutionOptions } from "./skill-resolution-options";
export declare function clearSkillCache(): void;
export declare function getAllSkills(options?: SkillResolutionOptions): Promise<LoadedSkill[]>;
