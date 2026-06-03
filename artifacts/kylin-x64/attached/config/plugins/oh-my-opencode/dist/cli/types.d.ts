export type ClaudeSubscription = "no" | "yes" | "max20";
export type BooleanArg = "no" | "yes";
export interface InstallArgs {
    tui: boolean;
    claude?: ClaudeSubscription;
    openai?: BooleanArg;
    gemini?: BooleanArg;
    copilot?: BooleanArg;
    opencodeZen?: BooleanArg;
    zaiCodingPlan?: BooleanArg;
    kimiForCoding?: BooleanArg;
    opencodeGo?: BooleanArg;
    vercelAiGateway?: BooleanArg;
    skipAuth?: boolean;
}
export interface InstallConfig {
    hasClaude: boolean;
    isMax20: boolean;
    hasOpenAI: boolean;
    hasGemini: boolean;
    hasCopilot: boolean;
    hasOpencodeZen: boolean;
    hasZaiCodingPlan: boolean;
    hasKimiForCoding: boolean;
    hasOpencodeGo: boolean;
    hasVercelAiGateway: boolean;
}
export interface ConfigMergeResult {
    success: boolean;
    configPath: string;
    error?: string;
}
export interface DetectedConfig {
    isInstalled: boolean;
    installedVersion: string | null;
    hasClaude: boolean;
    isMax20: boolean;
    hasOpenAI: boolean;
    hasGemini: boolean;
    hasCopilot: boolean;
    hasOpencodeZen: boolean;
    hasZaiCodingPlan: boolean;
    hasKimiForCoding: boolean;
    hasOpencodeGo: boolean;
    hasVercelAiGateway: boolean;
}
