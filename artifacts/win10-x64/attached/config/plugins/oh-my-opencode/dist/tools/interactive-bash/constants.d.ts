export declare const DEFAULT_TIMEOUT_MS = 60000;
export declare const BLOCKED_TMUX_SUBCOMMANDS: string[];
export declare const INTERACTIVE_BASH_DESCRIPTION = "WARNING: This is TMUX ONLY. Pass tmux subcommands directly (without 'tmux' prefix).\n\nExamples: new-session -d -s omo-dev, send-keys -t omo-dev \"vim\" Enter\n\nFor TUI apps needing ongoing interaction (vim, htop, pudb). One-shot commands \u2192 use Bash with &.";
