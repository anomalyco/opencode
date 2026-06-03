export interface OpenCodeBinaryInfo {
    binary: string;
    path: string;
}
export declare function getDesktopAppPaths(platform: NodeJS.Platform): string[];
export declare function getBinaryLookupCommand(platform: NodeJS.Platform): "which" | "where";
export declare function parseBinaryPaths(output: string): string[];
export declare function selectBinaryPath(paths: string[], platform: NodeJS.Platform): string | null;
export declare function buildVersionCommand(binaryPath: string, platform: NodeJS.Platform): string[];
export declare function findDesktopBinary(platform?: NodeJS.Platform, checkExists?: (path: string) => boolean): OpenCodeBinaryInfo | null;
export declare function findOpenCodeBinary(): Promise<OpenCodeBinaryInfo | null>;
export declare function getOpenCodeVersion(binaryPath: string, platform?: NodeJS.Platform): Promise<string | null>;
export declare function compareVersions(current: string, minimum: string): boolean;
