import type { BrowserAutomationProvider, GitMasterConfig } from "../../config/schema";
export interface SkillResolutionOptions {
    gitMasterConfig?: GitMasterConfig;
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
    /** Project directory to discover project-level skills from. Falls back to process.cwd() if not provided. */
    directory?: string;
}
