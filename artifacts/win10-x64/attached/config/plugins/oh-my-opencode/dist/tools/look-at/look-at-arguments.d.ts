import type { LookAtArgs } from "./types";
export interface LookAtArgsWithAlias extends LookAtArgs {
    path?: string;
}
export declare function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs;
export declare function validateArgs(args: LookAtArgs): string | null;
