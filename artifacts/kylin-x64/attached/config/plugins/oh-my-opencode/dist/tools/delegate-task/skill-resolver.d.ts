import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema";
export declare function resolveSkillContent(skills: string[], options: {
    gitMasterConfig?: GitMasterConfig;
    browserProvider?: BrowserAutomationProvider;
    disabledSkills?: Set<string>;
    directory?: string;
}): Promise<{
    content: string | undefined;
    contents: string[];
    error: string | null;
}>;
