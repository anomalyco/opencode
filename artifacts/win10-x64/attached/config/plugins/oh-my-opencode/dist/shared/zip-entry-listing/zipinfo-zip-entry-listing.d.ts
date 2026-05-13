import type { ArchiveEntry } from "../archive-entry-validator";
export declare function parseZipInfoListedEntry(line: string): ArchiveEntry | null;
export declare function isZipInfoZipListingAvailable(): boolean;
export declare function listZipEntriesWithZipInfo(archivePath: string): Promise<ArchiveEntry[]>;
