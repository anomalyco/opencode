export type ConfigLoadError = {
    path: string;
    error: string;
};
export declare function getConfigLoadErrors(): ConfigLoadError[];
export declare function clearConfigLoadErrors(): void;
export declare function addConfigLoadError(error: ConfigLoadError): void;
