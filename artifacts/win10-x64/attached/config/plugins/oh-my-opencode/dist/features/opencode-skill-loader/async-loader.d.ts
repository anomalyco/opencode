import type { SkillScope, LoadedSkill } from "./types";
import type { SkillMcpConfig } from "../skill-mcp-manager/types";
export declare function mapWithConcurrency<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency: number): Promise<R[]>;
export declare function loadMcpJsonFromDirAsync(skillDir: string): Promise<SkillMcpConfig | undefined>;
export declare function loadSkillFromPathAsync(skillPath: string, resolvedPath: string, defaultName: string, scope: SkillScope, namePrefix?: string): Promise<LoadedSkill | null>;
export declare function discoverSkillsInDirAsync(skillsDir: string, scope?: SkillScope, namePrefix?: string, depth?: number, maxDepth?: number): Promise<LoadedSkill[]>;
