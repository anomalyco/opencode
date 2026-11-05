export type ResolveImportPath = (specifier: string) => string | null;
export interface TransformSolidSourceOptions {
    filename: string;
    moduleName?: string;
    resolvePath?: ResolveImportPath;
}
export declare function stripQueryAndHash(path: string): string;
export declare function isNodeModulesPath(path: string): boolean;
export declare function resolveNodeSolidRuntimeImport(specifier: string): string | null;
export declare function transformSolidSource(code: string, options: TransformSolidSourceOptions): Promise<string>;
