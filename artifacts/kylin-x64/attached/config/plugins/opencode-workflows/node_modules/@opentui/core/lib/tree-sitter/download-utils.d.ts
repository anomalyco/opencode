export interface DownloadResult {
    content?: Buffer;
    filePath?: string;
    error?: string;
}
export declare class DownloadUtils {
    private static hashUrl;
    /**
     * Download a file from URL or load from local path, with caching support
     */
    static downloadOrLoad(source: string, cacheDir: string, cacheSubdir: string, fileExtension: string, useHashForCache?: boolean, filetype?: string): Promise<DownloadResult>;
    /**
     * Download and save a file to a specific target path
     */
    static downloadToPath(source: string, targetPath: string): Promise<DownloadResult>;
    /**
     * Fetch multiple highlight queries and concatenate them
     */
    static fetchHighlightQueries(sources: string[], cacheDir: string, filetype: string): Promise<string>;
    private static fetchHighlightQuery;
}
