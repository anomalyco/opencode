import type { SkillResolutionOptions } from "./skill-resolution-options";
export declare function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null;
export declare function resolveMultipleSkills(skillNames: string[], options?: SkillResolutionOptions): {
    resolved: Map<string, string>;
    notFound: string[];
};
export declare function resolveSkillContentAsync(skillName: string, options?: SkillResolutionOptions): Promise<string | null>;
export declare function resolveMultipleSkillsAsync(skillNames: string[], options?: SkillResolutionOptions): Promise<{
    resolved: Map<string, string>;
    notFound: string[];
}>;
