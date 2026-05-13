export interface BackupResult {
    success: boolean;
    backupPath?: string;
    error?: string;
}
export declare function backupConfigFile(configPath: string): BackupResult;
