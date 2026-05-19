export interface ParsedUserRequest {
    planName: string | null;
    explicitWorktreePath: string | null;
}
export declare function parseUserRequest(promptText: string): ParsedUserRequest;
