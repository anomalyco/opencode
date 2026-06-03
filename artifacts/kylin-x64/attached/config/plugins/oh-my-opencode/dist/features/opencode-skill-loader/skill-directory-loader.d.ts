import type { LoadedSkill, SkillScope } from "./types";
export declare function loadSkillsFromDir(options: {
    skillsDir: string;
    scope: SkillScope;
    namePrefix?: string;
    depth?: number;
    maxDepth?: number;
}): Promise<LoadedSkill[]>;
