export type PromptToolPermission = boolean | "allow" | "deny" | "ask";
export declare function normalizePromptTools(tools: Record<string, PromptToolPermission> | undefined): Record<string, boolean> | undefined;
export declare function resolveInheritedPromptTools(sessionID: string, fallbackTools?: Record<string, PromptToolPermission>): Record<string, boolean> | undefined;
