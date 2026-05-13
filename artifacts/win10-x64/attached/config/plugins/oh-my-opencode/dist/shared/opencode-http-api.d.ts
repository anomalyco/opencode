export declare function getServerBaseUrl(client: unknown): string | null;
export declare function patchPart(client: unknown, sessionID: string, messageID: string, partID: string, body: Record<string, unknown>): Promise<boolean>;
export declare function deletePart(client: unknown, sessionID: string, messageID: string, partID: string): Promise<boolean>;
