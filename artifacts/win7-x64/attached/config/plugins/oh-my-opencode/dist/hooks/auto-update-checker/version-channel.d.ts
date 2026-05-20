export declare function isPrereleaseVersion(version: string): boolean;
export declare function isDistTag(version: string): boolean;
export declare function isPrereleaseOrDistTag(pinnedVersion: string | null): boolean;
export declare function extractChannel(version: string | null): string;
