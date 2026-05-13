export type HealthCheckResult = {
    name: string;
    ok: boolean;
    target?: string;
    detail?: string;
    status?: number;
    latencyMs: number;
};
export type ApiHealthReport = {
    service: "opencode-api";
    ok: boolean;
    version: string;
    checks: HealthCheckResult[];
};
export declare function instructionCheck(): HealthCheckResult;
export declare function apiHealthReportSimple(): Promise<ApiHealthReport>;
export declare function apiHealthReport(): Promise<ApiHealthReport>;
export declare function isPublicHealthPath(path: string): boolean;
