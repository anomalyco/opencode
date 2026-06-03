import type { SkillsConfig, SkillDefinition } from "../../../config/schema";
export declare function normalizeSkillsConfig(config: SkillsConfig | undefined): {
    sources: Array<string | {
        path: string;
        recursive?: boolean;
        glob?: string;
    }>;
    enable: string[];
    disable: string[];
    entries: Record<string, boolean | SkillDefinition>;
};
