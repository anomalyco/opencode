/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus - Ultraworker").
 *
 * IMPORTANT: Display names MUST NOT contain parentheses or other characters
 * that are invalid in HTTP header values per RFC 7230. OpenCode passes the
 * agent name in the `x-opencode-agent-name` header, and parentheses cause
 * header validation failures that prevent agents from appearing in the UI
 * type selector dropdown. Use ` - ` (space-dash-space) instead of `(...)`.
 */
export declare const AGENT_DISPLAY_NAMES: Record<string, string>;
export declare function stripInvisibleAgentCharacters(agentName: string): string;
export declare function stripAgentListSortPrefix(agentName: string): string;
export declare function getAgentRuntimeName(configKey: string): string;
/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export declare function getAgentDisplayName(configKey: string): string;
/**
 * Runtime-facing agent name used for OpenCode list ordering.
 */
export declare function getAgentListDisplayName(configKey: string): string;
/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Atlas - Plan Executor" -> "atlas", "Atlas (Plan Executor)" -> "atlas", "atlas" -> "atlas"
 */
export declare function getAgentConfigKey(agentName: string): string;
/**
 * Normalize an agent name for prompt APIs.
 * - Known display names -> canonical display names
 * - Known config keys (any case) -> canonical display names
 * - Unknown/custom names -> preserved as-is (trimmed)
 */
export declare function normalizeAgentForPrompt(agentName: string | undefined): string | undefined;
export declare function normalizeAgentForPromptKey(agentName: string | undefined): string | undefined;
