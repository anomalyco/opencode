export interface WriteFileOptions {
    createPath?: boolean;
    mode?: number;
}
interface FileImportModule {
    default: string;
}
type FilePathFallback = string | URL | (() => string | URL);
export interface ResolveBundledFilePathOptions {
    loadBundledFileFallback?: boolean;
    useAssetRoot?: boolean;
}
export declare const sleep: (msOrDate: number | Date) => Promise<void>;
export declare const stringWidth: (text: string) => number;
export declare const stripANSI: (text: string) => string;
export declare const writeFile: (destination: string | URL, data: string | ArrayBufferView, options?: WriteFileOptions) => Promise<number>;
export declare function resolveBundledFilePath(key: string, loadBundledFile: () => Promise<FileImportModule>, fallbackPath: FilePathFallback, metaUrl: string, options?: ResolveBundledFilePathOptions): Promise<string>;
export {};
