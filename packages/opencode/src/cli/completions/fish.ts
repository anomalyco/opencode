/**
 * Fish shell completion script generator for OpenCode CLI
 */

export namespace FishCompletion {
  export function generate(): string {
    return `# OpenCode fish completion script
# Add to your ~/.config/fish/completions/opencode.fish:
#   opencode completion fish > ~/.config/fish/completions/opencode.fish

# Remove all existing completions for opencode
complete -c opencode -e

# Global options
complete -c opencode -s h -l help -d 'Show help'
complete -c opencode -s v -l version -d 'Show version'
complete -c opencode -l print-logs -d 'Print logs to stderr'
complete -c opencode -l log-level -xa 'DEBUG INFO WARN ERROR' -d 'Set log level'

# Main commands
complete -c opencode -f -n __fish_use_subcommand -a run -d 'Run opencode with a message'
complete -c opencode -f -n __fish_use_subcommand -a spawn -d 'Start TUI server and client'
complete -c opencode -f -n __fish_use_subcommand -a attach -d 'Connect to running server'
complete -c opencode -f -n __fish_use_subcommand -a serve -d 'Start server component'
complete -c opencode -f -n __fish_use_subcommand -a auth -d 'Manage API credentials'
complete -c opencode -f -n __fish_use_subcommand -a models -d 'List available models'
complete -c opencode -f -n __fish_use_subcommand -a agent -d 'Manage AI agents'
complete -c opencode -f -n __fish_use_subcommand -a config -d 'Configuration management'
complete -c opencode -f -n __fish_use_subcommand -a debug -d 'Diagnostic tools'
complete -c opencode -f -n __fish_use_subcommand -a mcp -d 'Model Context Protocol'
complete -c opencode -f -n __fish_use_subcommand -a export -d 'Export sessions'
complete -c opencode -f -n __fish_use_subcommand -a import -d 'Import data'
complete -c opencode -f -n __fish_use_subcommand -a stats -d 'Session statistics'
complete -c opencode -f -n __fish_use_subcommand -a upgrade -d 'Update OpenCode'
complete -c opencode -f -n __fish_use_subcommand -a web -d 'Start web interface'
complete -c opencode -f -n __fish_use_subcommand -a github -d 'GitHub integration'
complete -c opencode -f -n __fish_use_subcommand -a acp -d 'Agent Client Protocol'
complete -c opencode -f -n __fish_use_subcommand -a generate -d 'Code generation'
complete -c opencode -f -n __fish_use_subcommand -a thread -d 'Thread management'
complete -c opencode -f -n __fish_use_subcommand -a completion -d 'Shell completion'

# run command options
complete -c opencode -n '__fish_seen_subcommand_from run' -l command -d 'Command to run'
complete -c opencode -n '__fish_seen_subcommand_from run' -s c -l continue -d 'Continue last session'
complete -c opencode -n '__fish_seen_subcommand_from run' -s s -l session -d 'Session ID to continue'
complete -c opencode -n '__fish_seen_subcommand_from run' -l share -d 'Share the session'
complete -c opencode -n '__fish_seen_subcommand_from run' -s m -l model -d 'Model to use'
complete -c opencode -n '__fish_seen_subcommand_from run' -l agent -xa 'general build plan' -d 'Agent to use'
complete -c opencode -n '__fish_seen_subcommand_from run' -l format -xa 'default json' -d 'Output format'
complete -c opencode -n '__fish_seen_subcommand_from run' -s f -l file -rF -d 'File(s) to attach'
complete -c opencode -n '__fish_seen_subcommand_from run' -l title -d 'Session title'
complete -c opencode -n '__fish_seen_subcommand_from run' -l attach -d 'Server URL'
complete -c opencode -n '__fish_seen_subcommand_from run' -l port -d 'Local server port'

# serve command options
complete -c opencode -n '__fish_seen_subcommand_from serve' -l port -d 'Server port'
complete -c opencode -n '__fish_seen_subcommand_from serve' -l hostname -d 'Server hostname'
complete -c opencode -n '__fish_seen_subcommand_from serve' -l no-tui -d 'Disable TUI'

# spawn command options
complete -c opencode -n '__fish_seen_subcommand_from spawn' -l port -d 'Server port'

# attach command options
complete -c opencode -n '__fish_seen_subcommand_from attach' -l url -d 'Server URL'

# auth subcommands
complete -c opencode -n '__fish_seen_subcommand_from auth' -f -a login -d 'Authenticate with provider'
complete -c opencode -n '__fish_seen_subcommand_from auth' -f -a logout -d 'Remove credentials'
complete -c opencode -n '__fish_seen_subcommand_from auth' -f -a list -d 'Show providers'

# auth login options
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login' -l provider -xa 'anthropic openai google bedrock' -d 'Provider'

# debug subcommands
complete -c opencode -n '__fish_seen_subcommand_from debug' -f -a config -d 'Inspect configuration'
complete -c opencode -n '__fish_seen_subcommand_from debug' -f -a lsp -d 'Debug LSP'
complete -c opencode -n '__fish_seen_subcommand_from debug' -f -a file -d 'Analyze files'
complete -c opencode -n '__fish_seen_subcommand_from debug' -f -a rg -d 'Test ripgrep'
complete -c opencode -n '__fish_seen_subcommand_from debug' -f -a snapshot -d 'Create snapshots'

# mcp subcommands
complete -c opencode -n '__fish_seen_subcommand_from mcp' -f -a install -d 'Install MCP servers'
complete -c opencode -n '__fish_seen_subcommand_from mcp' -f -a list -d 'List MCP servers'

# completion subcommands
complete -c opencode -n '__fish_seen_subcommand_from completion' -f -a bash -d 'Bash completion'
complete -c opencode -n '__fish_seen_subcommand_from completion' -f -a zsh -d 'Zsh completion'
complete -c opencode -n '__fish_seen_subcommand_from completion' -f -a fish -d 'Fish completion'
complete -c opencode -n '__fish_seen_subcommand_from completion' -f -a powershell -d 'PowerShell completion'

# Model completions (common models)
complete -c opencode -n '__fish_seen_subcommand_from run; and __fish_seen_argument -l model -s m' -xa 'anthropic/claude-sonnet-4.5 anthropic/claude-opus-4 openai/gpt-4 openai/gpt-4o google/gemini-pro' -d 'Available models'
`.trim()
  }
}
