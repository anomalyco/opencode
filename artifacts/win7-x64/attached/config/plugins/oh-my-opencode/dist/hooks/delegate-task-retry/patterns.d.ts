export interface DelegateTaskErrorPattern {
    pattern: string;
    errorType: string;
    fixHint: string;
}
export declare const DELEGATE_TASK_ERROR_PATTERNS: DelegateTaskErrorPattern[];
export interface DetectedError {
    errorType: string;
    originalOutput: string;
}
export declare function detectDelegateTaskError(output: string): DetectedError | null;
