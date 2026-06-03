export interface ExpandEnvVarsOptions {
    trusted?: boolean;
}
export declare function expandEnvVars(value: string, options?: ExpandEnvVarsOptions): string;
export declare function expandEnvVarsInObject<T>(obj: T, options?: ExpandEnvVarsOptions): T;
