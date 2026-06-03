import type { SkillsConfig } from "../../config/schema";
import type { LoadedSkill } from "./types";
export declare function normalizePathForGlob(path: string): string;
export declare function discoverConfigSourceSkills(options: {
    config: SkillsConfig | undefined;
    configDir: string;
}): Promise<LoadedSkill[]>;
