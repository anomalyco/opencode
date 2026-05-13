import type { DoctorOptions, DoctorResult, CheckDefinition, CheckResult, DoctorSummary } from "./types";
export declare function runCheck(check: CheckDefinition): Promise<CheckResult>;
export declare function calculateSummary(results: CheckResult[], duration: number): DoctorSummary;
export declare function determineExitCode(results: CheckResult[]): number;
export declare function runDoctor(options: DoctorOptions): Promise<DoctorResult>;
