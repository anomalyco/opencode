import type { CheckStatus, DoctorIssue } from "./types";
export declare function formatStatusSymbol(status: CheckStatus): string;
export declare function formatStatusMark(available: boolean): string;
export declare function stripAnsi(str: string): string;
export declare function formatHeader(): string;
export declare function formatIssue(issue: DoctorIssue, index: number): string;
