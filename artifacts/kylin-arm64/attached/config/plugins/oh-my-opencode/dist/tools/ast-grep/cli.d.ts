import type { CliLanguage, SgResult } from "./types";
export { ensureCliAvailable, getAstGrepPath, isCliAvailable, startBackgroundInit, } from "./cli-binary-path-resolution";
export interface RunOptions {
    pattern: string;
    lang: CliLanguage;
    paths?: string[];
    globs?: string[];
    rewrite?: string;
    context?: number;
    updateAll?: boolean;
}
export declare function runSg(options: RunOptions): Promise<SgResult>;
