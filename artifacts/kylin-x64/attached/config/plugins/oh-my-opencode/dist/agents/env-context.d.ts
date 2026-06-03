/**
 * Creates OmO-specific environment context (timezone, locale).
 * Note: Working directory, platform, and date are already provided by OpenCode's system.ts,
 * so we only include fields that OpenCode doesn't provide to avoid duplication.
 * See: https://github.com/code-yeongyu/oh-my-openagent/issues/379
 */
export declare function createEnvContext(): string;
