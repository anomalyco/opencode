export declare function isWindowsAppDataDirectory(directory: string): boolean;
export declare function resolveSessionDirectory(options: {
    parentDirectory: string | null | undefined;
    fallbackDirectory: string;
    platform?: NodeJS.Platform;
    currentWorkingDirectory?: string;
}): string;
