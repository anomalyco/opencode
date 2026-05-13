import type { CommandInfo } from "../slashcommand/types";
import type { LoadedSkill } from "../../features/opencode-skill-loader";
export declare function matchSkillByName(skills: LoadedSkill[], requestedName: string): LoadedSkill | undefined;
export declare function matchCommandByName(commands: CommandInfo[], requestedName: string): CommandInfo | undefined;
export declare function findPartialMatches(skills: LoadedSkill[], commands: CommandInfo[], requestedName: string): string[];
