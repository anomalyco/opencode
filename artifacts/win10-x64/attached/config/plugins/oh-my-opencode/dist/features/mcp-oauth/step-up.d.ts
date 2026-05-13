export interface StepUpInfo {
    requiredScopes: string[];
    error?: string;
    errorDescription?: string;
}
export declare function parseWwwAuthenticate(header: string): StepUpInfo | null;
export declare function mergeScopes(existing: string[], required: string[]): string[];
export declare function isStepUpRequired(statusCode: number, headers: Record<string, string>): StepUpInfo | null;
