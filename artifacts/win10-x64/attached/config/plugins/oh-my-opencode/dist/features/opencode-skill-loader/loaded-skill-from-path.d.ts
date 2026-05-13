import type { SkillScope, LoadedSkill } from "./types";
export declare function loadSkillFromPath(options: {
    skillPath: string;
    resolvedPath: string;
    defaultName: string;
    scope: SkillScope;
    namePrefix?: string;
}): Promise<LoadedSkill | null>;
export declare function inferSkillNameFromFileName(filePath: string): string;
