export declare function collectCandidateBinaryPaths(pathEnv: string | undefined, which?: (command: string) => string | null | undefined, platform?: NodeJS.Platform): string[];
export declare function canExecuteBinary(binaryPath: string): Promise<boolean>;
export declare function findWorkingOpencodeBinary(pathEnv?: string | undefined, probe?: (binaryPath: string) => Promise<boolean>, which?: (command: string) => string | null | undefined, platform?: NodeJS.Platform): Promise<string | null>;
export declare function buildPathWithBinaryFirst(pathEnv: string | undefined, binaryPath: string): string;
export declare function withWorkingOpencodePath<T>(startServer: () => Promise<T>, finder?: (pathEnv: string | undefined) => Promise<string | null>): Promise<T>;
