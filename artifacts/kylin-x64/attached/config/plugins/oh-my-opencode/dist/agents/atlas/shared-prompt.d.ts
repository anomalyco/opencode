export interface AtlasPromptSections {
    intro: string;
    workflow: string;
    parallelExecution: string;
    verificationRules: string;
    boundaries: string;
    criticalRules: string;
}
export declare function buildAtlasPrompt(sections: AtlasPromptSections): string;
