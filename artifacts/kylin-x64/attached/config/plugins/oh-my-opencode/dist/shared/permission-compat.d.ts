/**
 * Permission system utilities for OpenCode 1.1.1+.
 * This module only supports the new permission format.
 */
export type PermissionValue = "ask" | "allow" | "deny";
export interface PermissionFormat {
    permission: Record<string, PermissionValue>;
}
/**
 * Creates tool restrictions that deny specified tools.
 */
export declare function createAgentToolRestrictions(denyTools: string[]): PermissionFormat;
/**
 * Creates tool restrictions that ONLY allow specified tools.
 * All other tools are denied by default using `*: deny` pattern.
 */
export declare function createAgentToolAllowlist(allowTools: string[]): PermissionFormat;
/**
 * Converts legacy tools format to permission format.
 * For migrating user configs from older versions.
 */
export declare function migrateToolsToPermission(tools: Record<string, boolean>): Record<string, PermissionValue>;
/**
 * Migrates agent config from legacy tools format to permission format.
 * If config has `tools`, converts to `permission`.
 */
export declare function migrateAgentConfig(config: Record<string, unknown>): Record<string, unknown>;
