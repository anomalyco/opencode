import type { ArchiveEntry } from "../archive-entry-validator";
export type PowerShellZipExtractor = "pwsh" | "powershell";
export declare function parsePowerShellZipEntryLine(line: string): ArchiveEntry | null;
export declare function listZipEntriesWithPowerShell(archivePath: string, escapePowerShellPath: (path: string) => string, extractor: PowerShellZipExtractor): Promise<ArchiveEntry[]>;
