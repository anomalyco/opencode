export type GrepBackend = "rg" | "grep";
export interface ResolvedCli {
    path: string;
    backend: GrepBackend;
}
export declare function resolveGrepCli(): ResolvedCli;
export declare function resolveGrepCliWithAutoInstall(): Promise<ResolvedCli>;
export declare const DEFAULT_MAX_DEPTH = 20;
export declare const DEFAULT_MAX_FILESIZE = "10M";
export declare const DEFAULT_MAX_COUNT = 500;
export declare const DEFAULT_MAX_COLUMNS = 1000;
export declare const DEFAULT_CONTEXT = 2;
export declare const DEFAULT_TIMEOUT_MS = 60000;
export declare const DEFAULT_MAX_OUTPUT_BYTES: number;
export declare const DEFAULT_RG_THREADS = 4;
export declare const RG_SAFETY_FLAGS: readonly ["--no-follow", "--color=never", "--no-heading", "--line-number", "--with-filename"];
export declare const GREP_SAFETY_FLAGS: readonly ["-n", "-H", "--color=never"];
