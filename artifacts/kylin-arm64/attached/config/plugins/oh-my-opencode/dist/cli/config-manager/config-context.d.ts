import type { OpenCodeBinaryType, OpenCodeConfigPaths } from "../../shared/opencode-config-dir-types";
export interface ConfigContext {
    binary: OpenCodeBinaryType;
    version: string | null;
    paths: OpenCodeConfigPaths;
}
export declare function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void;
export declare function getConfigContext(): ConfigContext;
export declare function resetConfigContext(): void;
export declare function getConfigDir(): string;
export declare function getConfigJson(): string;
export declare function getConfigJsonc(): string;
export declare function getOmoConfigPath(): string;
