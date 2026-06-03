import type { CommandDefinition } from "../claude-code-command-loader/types";
import type { LoadedSkill } from "./types";
export declare function skillsToCommandDefinitionRecord(skills: LoadedSkill[]): Record<string, CommandDefinition>;
