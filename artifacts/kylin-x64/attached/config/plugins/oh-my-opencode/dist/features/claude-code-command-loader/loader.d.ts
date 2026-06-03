import type { CommandDefinition } from "./types";
export declare function loadUserCommands(): Promise<Record<string, CommandDefinition>>;
export declare function loadProjectCommands(directory?: string): Promise<Record<string, CommandDefinition>>;
export declare function loadOpencodeGlobalCommands(): Promise<Record<string, CommandDefinition>>;
export declare function loadOpencodeProjectCommands(directory?: string): Promise<Record<string, CommandDefinition>>;
export declare function loadAllCommands(directory?: string): Promise<Record<string, CommandDefinition>>;
