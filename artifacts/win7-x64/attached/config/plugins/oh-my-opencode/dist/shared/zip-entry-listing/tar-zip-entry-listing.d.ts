import type { ArchiveEntry } from "../archive-entry-validator";
export declare function parseTarListingOutput(stdout: string): ArchiveEntry[];
export declare function listZipEntriesWithTar(archivePath: string): Promise<ArchiveEntry[]>;
