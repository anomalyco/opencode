import type { CommandDefinition } from "../claude-code-command-loader/types";
import type { LoadedSkill } from "./types";
export declare function loadUserSkills(): Promise<Record<string, CommandDefinition>>;
export declare function loadProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>>;
export declare function loadOpencodeGlobalSkills(): Promise<Record<string, CommandDefinition>>;
export declare function loadOpencodeProjectSkills(directory?: string): Promise<Record<string, CommandDefinition>>;
export declare function loadProjectAgentsSkills(directory?: string): Promise<Record<string, CommandDefinition>>;
export declare function loadGlobalAgentsSkills(): Promise<Record<string, CommandDefinition>>;
export interface DiscoverSkillsOptions {
    includeClaudeCodePaths?: boolean;
    directory?: string;
}
export declare function discoverAllSkills(directory?: string): Promise<LoadedSkill[]>;
export declare function discoverSkills(options?: DiscoverSkillsOptions): Promise<LoadedSkill[]>;
export declare function getSkillByName(name: string, options?: DiscoverSkillsOptions): Promise<LoadedSkill | undefined>;
export declare function discoverUserClaudeSkills(): Promise<LoadedSkill[]>;
export declare function discoverProjectClaudeSkills(directory?: string): Promise<LoadedSkill[]>;
export declare function discoverOpencodeGlobalSkills(): Promise<LoadedSkill[]>;
export declare function discoverOpencodeProjectSkills(directory?: string): Promise<LoadedSkill[]>;
export declare function discoverProjectAgentsSkills(directory?: string): Promise<LoadedSkill[]>;
export declare function discoverGlobalAgentsSkills(): Promise<LoadedSkill[]>;
