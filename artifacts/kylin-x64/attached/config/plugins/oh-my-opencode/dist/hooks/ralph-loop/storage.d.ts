import type { RalphLoopState } from "./types";
export declare function getStateFilePath(directory: string, customPath?: string): string;
export declare function readState(directory: string, customPath?: string): RalphLoopState | null;
export declare function writeState(directory: string, state: RalphLoopState, customPath?: string): boolean;
export declare function clearState(directory: string, customPath?: string): boolean;
export declare function incrementIteration(directory: string, customPath?: string): RalphLoopState | null;
