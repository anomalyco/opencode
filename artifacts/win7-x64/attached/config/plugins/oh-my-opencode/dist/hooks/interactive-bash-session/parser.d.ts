/**
 * Quote-aware command tokenizer with escape handling
 * Handles single/double quotes and backslash escapes
 */
export declare function tokenizeCommand(cmd: string): string[];
/**
 * Normalize session name by stripping :window and .pane suffixes
 * e.g., "omo-x:1" -> "omo-x", "omo-x:1.2" -> "omo-x"
 */
export declare function normalizeSessionName(name: string): string;
export declare function findFlagValue(tokens: string[], flag: string): string | null;
/**
 * Extract session name from tokens, considering the subCommand
 * For new-session: prioritize -s over -t
 * For other commands: use -t
 */
export declare function extractSessionNameFromTokens(tokens: string[], subCommand: string): string | null;
/**
 * Find the tmux subcommand from tokens, skipping global options.
 * tmux allows global options before the subcommand:
 * e.g., `tmux -L socket-name new-session -s omo-x`
 * Global options with args: -L, -S, -f, -c, -T
 * Standalone flags: -C, -v, -V, etc.
 * Special: -- (end of options marker)
 */
export declare function findSubcommand(tokens: string[]): string;
