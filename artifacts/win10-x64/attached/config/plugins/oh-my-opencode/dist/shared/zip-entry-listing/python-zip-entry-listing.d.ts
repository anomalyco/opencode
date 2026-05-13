import type { ArchiveEntry } from "../archive-entry-validator";
export declare function isPythonZipListingAvailable(): boolean;
export declare function listZipEntriesWithPython(archivePath: string): Promise<ArchiveEntry[]>;
