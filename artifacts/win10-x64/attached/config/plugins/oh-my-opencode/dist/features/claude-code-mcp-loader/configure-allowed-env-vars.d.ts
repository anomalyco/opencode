export declare function getAllowedMcpEnvVars(): Set<string>;
export declare function isSensitiveMcpEnvVar(varName: string): boolean;
export declare function isAllowedMcpEnvVar(varName: string): boolean;
export declare function setAdditionalAllowedMcpEnvVars(varNames: string[]): void;
export declare function resetAdditionalAllowedMcpEnvVars(): void;
