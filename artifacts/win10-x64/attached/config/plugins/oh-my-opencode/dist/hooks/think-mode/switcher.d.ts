/**
 * Think Mode Switcher
 *
 * This module handles "thinking mode" activation for reasoning-capable models.
 * When a user includes "think" keywords in their prompt, models are upgraded to
 * their high-reasoning variants with extended thinking budgets.
 *
 * PROVIDER ALIASING:
 * GitHub Copilot acts as a proxy provider that routes to underlying providers
 * (Anthropic, Google, OpenAI). We resolve the proxy to the actual provider
 * based on model name patterns, allowing GitHub Copilot to inherit thinking
 * configurations without duplication.
 *
 * NORMALIZATION:
 * Model IDs are normalized (dots → hyphens in version numbers) to handle API
 * inconsistencies defensively while maintaining backwards compatibility.
 */
export declare function getHighVariant(modelID: string): string | null;
export declare function isAlreadyHighVariant(modelID: string): boolean;
