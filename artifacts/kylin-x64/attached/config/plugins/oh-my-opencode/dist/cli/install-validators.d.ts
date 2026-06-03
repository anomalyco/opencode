import type { BooleanArg, ClaudeSubscription, DetectedConfig, InstallArgs, InstallConfig } from "./types";
export declare const SYMBOLS: {
    check: string;
    cross: string;
    arrow: string;
    bullet: string;
    info: string;
    warn: string;
    star: string;
};
export declare function formatConfigSummary(config: InstallConfig): string;
export declare function printHeader(isUpdate: boolean): void;
export declare function printStep(step: number, total: number, message: string): void;
export declare function printSuccess(message: string): void;
export declare function printError(message: string): void;
export declare function printInfo(message: string): void;
export declare function printWarning(message: string): void;
export declare function printBox(content: string, title?: string): void;
export declare function validateNonTuiArgs(args: InstallArgs): {
    valid: boolean;
    errors: string[];
};
export declare function argsToConfig(args: InstallArgs): InstallConfig;
export declare function detectedToInitialValues(detected: DetectedConfig): {
    claude: ClaudeSubscription;
    openai: BooleanArg;
    gemini: BooleanArg;
    copilot: BooleanArg;
    opencodeZen: BooleanArg;
    zaiCodingPlan: BooleanArg;
    kimiForCoding: BooleanArg;
    opencodeGo: BooleanArg;
    vercelAiGateway: BooleanArg;
};
