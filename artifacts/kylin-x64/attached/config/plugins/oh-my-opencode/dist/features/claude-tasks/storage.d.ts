import type { z } from "zod";
import type { OhMyOpenCodeConfig } from "../../config/schema";
export declare function getTaskDir(config?: Partial<OhMyOpenCodeConfig>): string;
export declare function sanitizePathSegment(value: string): string;
export declare function resolveTaskListId(config?: Partial<OhMyOpenCodeConfig>): string;
export declare function ensureDir(dirPath: string): void;
export declare function readJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null;
export declare function writeJsonAtomic(filePath: string, data: unknown): void;
export declare function generateTaskId(): string;
export declare function listTaskFiles(config?: Partial<OhMyOpenCodeConfig>): string[];
export declare function acquireLock(dirPath: string): {
    acquired: boolean;
    release: () => void;
};
