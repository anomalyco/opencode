export declare namespace PackageRegistry {
    function info(pkg: string, field: string, cwd?: string): Promise<string | null>;
    function isOutdated(pkg: string, cachedVersion: string, cwd?: string): Promise<boolean>;
}
