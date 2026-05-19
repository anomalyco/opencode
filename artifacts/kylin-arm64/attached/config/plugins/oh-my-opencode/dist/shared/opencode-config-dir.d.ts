import type { OpenCodeBinaryType, OpenCodeConfigDirOptions, OpenCodeConfigPaths } from "./opencode-config-dir-types";
export type { OpenCodeBinaryType, OpenCodeConfigDirOptions, OpenCodeConfigPaths, } from "./opencode-config-dir-types";
export declare const TAURI_APP_IDENTIFIER = "ai.opencode.desktop";
export declare const TAURI_APP_IDENTIFIER_DEV = "ai.opencode.desktop.dev";
export declare function isDevBuild(version: string | null | undefined): boolean;
export declare function getOpenCodeConfigDir(options: OpenCodeConfigDirOptions): string;
export declare function getOpenCodeConfigPaths(options: OpenCodeConfigDirOptions): OpenCodeConfigPaths;
export declare function detectExistingConfigDir(binary: OpenCodeBinaryType, version?: string | null): string | null;
