export interface EnvironmentCheckResult {
    cli: {
        available: boolean;
        path: string;
        error?: string;
    };
    napi: {
        available: boolean;
        error?: string;
    };
}
/**
 * Check if ast-grep CLI and NAPI are available.
 * Call this at startup to provide early feedback about missing dependencies.
 */
export declare function checkEnvironment(): EnvironmentCheckResult;
/**
 * Format environment check result as user-friendly message.
 */
export declare function formatEnvironmentCheck(result: EnvironmentCheckResult): string;
