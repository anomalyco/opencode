type CompactionMessageLike = {
    agent?: unknown;
    info?: {
        agent?: unknown;
    };
    parts?: unknown;
};
export declare function isCompactionAgent(agent: unknown): boolean;
export declare function hasCompactionPart(parts: unknown): boolean;
export declare function isCompactionMessage(message: CompactionMessageLike): boolean;
export declare function getCompactionPartStorageDir(messageID: string): string;
export declare function hasCompactionPartInStorage(messageID: string | undefined): boolean;
export {};
