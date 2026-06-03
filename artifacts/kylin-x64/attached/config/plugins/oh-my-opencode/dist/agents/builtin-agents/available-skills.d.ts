import type { AvailableSkill } from "../dynamic-agent-prompt-builder";
import type { BrowserAutomationProvider } from "../../config/schema";
import type { LoadedSkill } from "../../features/opencode-skill-loader/types";
export declare function buildAvailableSkills(discoveredSkills: LoadedSkill[], browserProvider?: BrowserAutomationProvider, disabledSkills?: Set<string>): AvailableSkill[];
