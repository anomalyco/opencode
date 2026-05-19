/**
 * Detects external plugins that may conflict with oh-my-opencode features.
 * Used to prevent crashes from concurrent notification plugins.
 */
export interface ExternalNotifierResult {
    detected: boolean;
    pluginName: string | null;
    allPlugins: string[];
}
export interface ExternalSkillPluginResult {
    detected: boolean;
    pluginName: string | null;
    allPlugins: string[];
}
/**
 * Detect if any external notification plugin is configured.
 * Returns information about detected plugins for logging/warning.
 */
export declare function detectExternalNotificationPlugin(directory: string): ExternalNotifierResult;
/**
 * Detect if any external skill plugin is configured.
 * Returns information about detected plugins for logging/warning.
 */
export declare function detectExternalSkillPlugin(directory: string): ExternalSkillPluginResult;
/**
 * Generate a warning message for users with conflicting notification plugins.
 */
export declare function getNotificationConflictWarning(pluginName: string): string;
/**
 * Generate a warning message for users with conflicting skill plugins.
 */
export declare function getSkillPluginConflictWarning(pluginName: string): string;
