import type { OhMyOpenCodeConfig } from "../../config/schema";
export declare function getSessionTaskDir(config: Partial<OhMyOpenCodeConfig>, sessionID: string): string;
export declare function listSessionTaskFiles(config: Partial<OhMyOpenCodeConfig>, sessionID: string): string[];
export declare function listAllSessionDirs(config: Partial<OhMyOpenCodeConfig>): string[];
export interface TaskLocation {
    path: string;
    sessionID: string;
}
export declare function findTaskAcrossSessions(config: Partial<OhMyOpenCodeConfig>, taskId: string): TaskLocation | null;
