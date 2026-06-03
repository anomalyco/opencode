export type SessionPermissionRule = {
    permission: string;
    action: "allow" | "deny";
    pattern: string;
};
export declare const QUESTION_DENIED_SESSION_PERMISSION: SessionPermissionRule[];
