// Shared environment constants for non-interactive tool execution
// Used by both core and opencode tool implementations

/**
 * Default environment variables for non-interactive tool execution.
 * These prevent prompts and hangs in automated environments.
 */
export const NON_INTERACTIVE_ENV = {
  CI: "1",
  npm_config_yes: "true",
  pnpm_config_yes: "true",
  GIT_TERMINAL_PROMPT: "0",
  NONINTERACTIVE: "1",
  TERM: "dumb",
} as const;

/**
 * Merge non-interactive env with user-provided env, giving precedence to user values.
 * This ensures hardening doesn't override explicit user intent.
 */
export function mergeNonInteractiveEnv(userEnv?: Record<string, string>): Record<string, string> {
  return { ...NON_INTERACTIVE_ENV, ...userEnv };
}