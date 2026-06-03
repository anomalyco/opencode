import type { BuiltinSkill } from "./types";
import type { BrowserAutomationProvider } from "../../config/schema";
export interface CreateBuiltinSkillsOptions {
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
}
export declare function createBuiltinSkills(options?: CreateBuiltinSkillsOptions): BuiltinSkill[];
