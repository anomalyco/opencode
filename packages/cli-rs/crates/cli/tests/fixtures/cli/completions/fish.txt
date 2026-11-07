###-begin-opencode-completions-###
#
# Static completion script for Fish
#
# Installation:
#   opencode --completions fish > ~/.config/fish/completions/opencode.fish
#

complete -c opencode -n '__fish_use_subcommand' -f
complete -c opencode -n '__fish_use_subcommand' -f -a 'upgrade' -d 'Upgrade OpenCode to the latest or a specific version'
complete -c opencode -n '__fish_use_subcommand' -f -a 'update' -d 'Upgrade OpenCode to the latest or a specific version'
complete -c opencode -n '__fish_use_subcommand' -f -a 'uninstall' -d 'Uninstall OpenCode, keeping session data, configuration, and state'
complete -c opencode -n '__fish_use_subcommand' -f -a 'acp' -d 'Start an Agent Client Protocol server'
complete -c opencode -n '__fish_use_subcommand' -f -a 'api' -d 'Make a request to the running server'
complete -c opencode -n '__fish_use_subcommand' -f -a 'debug' -d 'Debugging and troubleshooting tools'
complete -c opencode -n '__fish_use_subcommand' -f -a 'auth' -d 'manage integrations and credentials'
complete -c opencode -n '__fish_use_subcommand' -f -a 'mcp' -d 'Manage MCP (Model Context Protocol) servers'
complete -c opencode -n '__fish_use_subcommand' -f -a 'plugin' -d 'Manage plugins'
complete -c opencode -n '__fish_use_subcommand' -f -a 'models' -d 'List all available models'
complete -c opencode -n '__fish_use_subcommand' -f -a 'stats' -d 'Show shareable usage statistics'
complete -c opencode -n '__fish_use_subcommand' -f -a 'mini' -d 'Start the minimal interactive interface'
complete -c opencode -n '__fish_use_subcommand' -f -a 'run' -d 'Run OpenCode with a message'
complete -c opencode -n '__fish_use_subcommand' -f -a 'session' -d 'Manage sessions'
complete -c opencode -n '__fish_use_subcommand' -f -a 'service' -d 'Manage the background server'
complete -c opencode -n '__fish_use_subcommand' -f -a 'reload' -d 'Reload configuration'
complete -c opencode -n '__fish_use_subcommand' -f -a 'pair' -d 'Print one-time links to connect a browser or app'
complete -c opencode -n '__fish_use_subcommand' -f -a 'serve' -d 'Start the v2 API and web server'
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt standalone no-standalone' -l standalone -d 'Run with a private server instead of the background service'
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt standalone no-standalone' -l no-standalone -d 'Disable standalone'
complete -c opencode -n '__fish_use_subcommand; and begin; not __fish_contains_opt server; or contains -- (commandline -poc)[-1] --server; end' -l server -d 'Connect to a server URL instead of the background service' -r -f
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt auto no-auto' -l auto -d 'Auto-approve permissions that are not explicitly denied'
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt auto no-auto' -l no-auto -d 'Disable auto'
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt -s c continue no-continue' -l continue -s c -d 'Continue the last session'
complete -c opencode -n '__fish_use_subcommand; and not __fish_contains_opt -s c continue no-continue' -l no-continue -d 'Disable continue'
complete -c opencode -n '__fish_use_subcommand; and begin; not __fish_contains_opt -s s session; or contains -- (commandline -poc)[-1] --session -s; end' -l session -s s -d 'Session ID to continue, or to create if it does not exist' -r -f
complete -c opencode -n '__fish_use_subcommand; and begin; not __fish_contains_opt prompt; or contains -- (commandline -poc)[-1] --prompt; end' -l prompt -d 'Prompt to use' -r -f
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt standalone no-standalone' -f -a '--standalone' -d 'Run with a private server instead of the background service'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt standalone no-standalone' -f -a '--no-standalone' -d 'Disable standalone'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt server' -f -a '--server' -d 'Connect to a server URL instead of the background service'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt auto no-auto' -f -a '--auto' -d 'Auto-approve permissions that are not explicitly denied'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt auto no-auto' -f -a '--no-auto' -d 'Disable auto'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--continue' -d 'Continue the last session'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--no-continue' -d 'Disable continue'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s s session' -f -a '--session' -d 'Session ID to continue, or to create if it does not exist'
complete -c opencode -n '__fish_use_subcommand; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt prompt' -f -a '--prompt' -d 'Prompt to use'
complete -c opencode -n '__fish_seen_subcommand_from upgrade' -f
complete -c opencode -n '__fish_seen_subcommand_from upgrade; and begin; not __fish_contains_opt -s m method; or contains -- (commandline -poc)[-1] --method -m; end' -l method -s m -d 'Installation method to use' -r -f -a 'curl npm pnpm bun yarn vp brew winget'
complete -c opencode -n '__fish_seen_subcommand_from upgrade; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s m method' -f -a '--method' -d 'Installation method to use'
complete -c opencode -n '__fish_seen_subcommand_from update' -f
complete -c opencode -n '__fish_seen_subcommand_from update; and begin; not __fish_contains_opt -s m method; or contains -- (commandline -poc)[-1] --method -m; end' -l method -s m -d 'Installation method to use' -r -f -a 'curl npm pnpm bun yarn vp brew winget'
complete -c opencode -n '__fish_seen_subcommand_from update; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s m method' -f -a '--method' -d 'Installation method to use'
complete -c opencode -n '__fish_seen_subcommand_from uninstall' -f
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not __fish_contains_opt dry-run no-dry-run' -l dry-run -d 'Show what would be removed without removing'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not __fish_contains_opt dry-run no-dry-run' -l no-dry-run -d 'Disable dry-run'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not __fish_contains_opt -s f force no-force' -l force -s f -d 'Skip confirmation prompts'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not __fish_contains_opt -s f force no-force' -l no-force -d 'Disable force'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt dry-run no-dry-run' -f -a '--dry-run' -d 'Show what would be removed without removing'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt dry-run no-dry-run' -f -a '--no-dry-run' -d 'Disable dry-run'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s f force no-force' -f -a '--force' -d 'Skip confirmation prompts'
complete -c opencode -n '__fish_seen_subcommand_from uninstall; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s f force no-force' -f -a '--no-force' -d 'Disable force'
complete -c opencode -n '__fish_seen_subcommand_from acp' -f
complete -c opencode -n '__fish_seen_subcommand_from acp; and not __fish_contains_opt login no-login' -l login -d 'Run auth login instead of starting the server'
complete -c opencode -n '__fish_seen_subcommand_from acp; and not __fish_contains_opt login no-login' -l no-login -d 'Disable login'
complete -c opencode -n '__fish_seen_subcommand_from acp; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt login no-login' -f -a '--login' -d 'Run auth login instead of starting the server'
complete -c opencode -n '__fish_seen_subcommand_from acp; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt login no-login' -f -a '--no-login' -d 'Disable login'
complete -c opencode -n '__fish_seen_subcommand_from api' -f
complete -c opencode -n '__fish_seen_subcommand_from api; and begin; not __fish_contains_opt -s d data; or contains -- (commandline -poc)[-1] --data -d; end' -l data -s d -d 'Request body' -r -f
complete -c opencode -n '__fish_seen_subcommand_from api; and begin; not __fish_contains_opt -s H header; or contains -- (commandline -poc)[-1] --header -H; end' -l header -s H -d 'Request header in name:value form' -r -f
complete -c opencode -n '__fish_seen_subcommand_from api; and begin; not __fish_contains_opt param; or contains -- (commandline -poc)[-1] --param; end' -l param -d 'OpenAPI path or query parameter' -r -f
complete -c opencode -n '__fish_seen_subcommand_from api; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s d data' -f -a '--data' -d 'Request body'
complete -c opencode -n '__fish_seen_subcommand_from api; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s H header' -f -a '--header' -d 'Request header in name:value form'
complete -c opencode -n '__fish_seen_subcommand_from api; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt param' -f -a '--param' -d 'OpenAPI path or query parameter'
complete -c opencode -n '__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from agents config heap-dump paths' -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from agents config heap-dump paths' -f -a 'agents' -d 'List all agents'
complete -c opencode -n '__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from agents config heap-dump paths' -f -a 'config' -d 'List configuration sources'
complete -c opencode -n '__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from agents config heap-dump paths' -f -a 'heap-dump' -d 'Write a heap snapshot of the running server and print its path'
complete -c opencode -n '__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from agents config heap-dump paths' -f -a 'paths' -d 'Show global paths (data, config, cache, state)'
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from agents' -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from config' -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from heap-dump' -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from heap-dump; and begin; not __fish_contains_opt directory; or contains -- (commandline -poc)[-1] --directory; end' -l directory -d 'Directory to write the snapshot into instead of the server\'s log directory' -r -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from heap-dump; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt directory' -f -a '--directory' -d 'Directory to write the snapshot into instead of the server\'s log directory'
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from paths' -f
complete -c opencode -n '__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from paths' -r -f -a 'db home data config cache state tmp bin log repos' -d 'Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'list' -d 'list integrations and credentials'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'login' -d 'connect an integration'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'logout' -d 'log out of a saved account'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'export' -d 'print stored credentials, including secrets, as JSON'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'import' -d 'import credentials exported by auth export'
complete -c opencode -n '__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from list login logout export import switch' -f -a 'switch' -d 'switch the active account for an integration'
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from list' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from list; and begin; not __fish_contains_opt format; or contains -- (commandline -poc)[-1] --format; end' -l format -d 'Output format' -r -f -a 'default json'
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from list; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt format' -f -a '--format' -d 'Output format'
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login; and begin; not __fish_contains_opt method; or contains -- (commandline -poc)[-1] --method; end' -l method -d 'Authentication method ID' -r -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login; and begin; not __fish_contains_opt answer; or contains -- (commandline -poc)[-1] --answer; end' -l answer -d 'Provider form answer (key=value; repeat for multiple fields)' -r -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt method' -f -a '--method' -d 'Authentication method ID'
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from login; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt answer' -f -a '--answer' -d 'Provider form answer (key=value; repeat for multiple fields)'
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from logout' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from export' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from import' -f
complete -c opencode -n '__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from switch' -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list add auth logout' -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list add auth logout' -f -a 'list' -d 'List configured MCP servers and their status'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list add auth logout' -f -a 'add' -d 'Add an MCP server to your configuration'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list add auth logout' -f -a 'auth' -d 'Authenticate with an OAuth-capable remote MCP server'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list add auth logout' -f -a 'logout' -d 'Remove stored OAuth credentials for an MCP server'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from list' -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add' -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and begin; not __fish_contains_opt url; or contains -- (commandline -poc)[-1] --url; end' -l url -d 'URL for a remote MCP server' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and begin; not __fish_contains_opt header; or contains -- (commandline -poc)[-1] --header; end' -l header -d 'HTTP header for a remote server, as name=value' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and begin; not __fish_contains_opt env; or contains -- (commandline -poc)[-1] --env; end' -l env -d 'Environment variable for a local server, as name=value' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not __fish_contains_opt global no-global' -l global -d 'Write to the global config instead of the project config'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not __fish_contains_opt global no-global' -l no-global -d 'Disable global'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt url' -f -a '--url' -d 'URL for a remote MCP server'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt header' -f -a '--header' -d 'HTTP header for a remote server, as name=value'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt env' -f -a '--env' -d 'Environment variable for a local server, as name=value'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt global no-global' -f -a '--global' -d 'Write to the global config instead of the project config'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt global no-global' -f -a '--no-global' -d 'Disable global'
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from auth' -f
complete -c opencode -n '__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from logout' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f -a 'list' -d 'List plugins'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f -a 'add' -d 'Install a plugin and add it to the global configuration'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f -a 'check' -d 'Check package plugins for updates'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f -a 'update' -d 'Update package plugins'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list add check update remove' -f -a 'remove' -d 'Remove a plugin from global configuration'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list; and not __fish_contains_opt builtin no-builtin' -l builtin -d 'Include built-in server plugins'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list; and not __fish_contains_opt builtin no-builtin' -l no-builtin -d 'Disable builtin'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt builtin no-builtin' -f -a '--builtin' -d 'Include built-in server plugins'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt builtin no-builtin' -f -a '--no-builtin' -d 'Disable builtin'
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from add' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from check' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from update' -f
complete -c opencode -n '__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from remove' -f
complete -c opencode -n '__fish_seen_subcommand_from models' -f
complete -c opencode -n '__fish_seen_subcommand_from stats' -f
complete -c opencode -n '__fish_seen_subcommand_from stats; and begin; not __fish_contains_opt days; or contains -- (commandline -poc)[-1] --days; end' -l days -d 'Show the last N days; 0 means today' -r -f
complete -c opencode -n '__fish_seen_subcommand_from stats; and begin; not __fish_contains_opt year; or contains -- (commandline -poc)[-1] --year; end' -l year -d 'Show a calendar year' -r -f
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt all no-all' -l all -d 'Show lifetime statistics'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt all no-all' -l no-all -d 'Disable all'
complete -c opencode -n '__fish_seen_subcommand_from stats; and begin; not __fish_contains_opt project; or contains -- (commandline -poc)[-1] --project; end' -l project -d 'Filter by project ID, or use "." for the current project' -r -f
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt models no-models' -l models -d 'Show model usage'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt models no-models' -l no-models -d 'Disable models'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt tools no-tools' -l tools -d 'Show tool reliability'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt tools no-tools' -l no-tools -d 'Disable tools'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt cost no-cost' -l cost -d 'Show cost and token details'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt cost no-cost' -l no-cost -d 'Disable cost'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt full no-full' -l full -d 'Show every detailed section'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt full no-full' -l no-full -d 'Disable full'
complete -c opencode -n '__fish_seen_subcommand_from stats; and begin; not __fish_contains_opt limit; or contains -- (commandline -poc)[-1] --limit; end' -l limit -d 'Number of rows in detailed sections' -r -f
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt json no-json' -l json -d 'Output statistics as JSON'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not __fish_contains_opt json no-json' -l no-json -d 'Disable json'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt days' -f -a '--days' -d 'Show the last N days; 0 means today'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt year' -f -a '--year' -d 'Show a calendar year'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt all no-all' -f -a '--all' -d 'Show lifetime statistics'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt all no-all' -f -a '--no-all' -d 'Disable all'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt project' -f -a '--project' -d 'Filter by project ID, or use "." for the current project'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt models no-models' -f -a '--models' -d 'Show model usage'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt models no-models' -f -a '--no-models' -d 'Disable models'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt tools no-tools' -f -a '--tools' -d 'Show tool reliability'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt tools no-tools' -f -a '--no-tools' -d 'Disable tools'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt cost no-cost' -f -a '--cost' -d 'Show cost and token details'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt cost no-cost' -f -a '--no-cost' -d 'Disable cost'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt full no-full' -f -a '--full' -d 'Show every detailed section'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt full no-full' -f -a '--no-full' -d 'Disable full'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt limit' -f -a '--limit' -d 'Number of rows in detailed sections'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt json no-json' -f -a '--json' -d 'Output statistics as JSON'
complete -c opencode -n '__fish_seen_subcommand_from stats; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt json no-json' -f -a '--no-json' -d 'Disable json'
complete -c opencode -n '__fish_seen_subcommand_from mini' -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt -s c continue no-continue' -l continue -s c -d 'Continue the last session'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt -s c continue no-continue' -l no-continue -d 'Disable continue'
complete -c opencode -n '__fish_seen_subcommand_from mini; and begin; not __fish_contains_opt -s s session; or contains -- (commandline -poc)[-1] --session -s; end' -l session -s s -d 'Session ID to continue, or to create if it does not exist' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt fork no-fork' -l fork -d 'Fork the session when continuing'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt fork no-fork' -l no-fork -d 'Disable fork'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt replay no-replay' -l replay -d 'Restore session history on resume and resize (disable with --no-replay)'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not __fish_contains_opt replay no-replay' -l no-replay -d 'Disable replay'
complete -c opencode -n '__fish_seen_subcommand_from mini; and begin; not __fish_contains_opt replay-limit; or contains -- (commandline -poc)[-1] --replay-limit; end' -l replay-limit -d 'Limit replay to the newest N messages (default: 200)' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and begin; not __fish_contains_opt -s m model; or contains -- (commandline -poc)[-1] --model -m; end' -l model -s m -d 'Model to use in the format provider/model' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and begin; not __fish_contains_opt agent; or contains -- (commandline -poc)[-1] --agent; end' -l agent -d 'Agent to use' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and begin; not __fish_contains_opt prompt; or contains -- (commandline -poc)[-1] --prompt; end' -l prompt -d 'Prompt to use' -r -f
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--continue' -d 'Continue the last session'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--no-continue' -d 'Disable continue'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s s session' -f -a '--session' -d 'Session ID to continue, or to create if it does not exist'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt fork no-fork' -f -a '--fork' -d 'Fork the session when continuing'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt fork no-fork' -f -a '--no-fork' -d 'Disable fork'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt replay no-replay' -f -a '--replay' -d 'Restore session history on resume and resize (disable with --no-replay)'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt replay no-replay' -f -a '--no-replay' -d 'Disable replay'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt replay-limit' -f -a '--replay-limit' -d 'Limit replay to the newest N messages (default: 200)'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s m model' -f -a '--model' -d 'Model to use in the format provider/model'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt agent' -f -a '--agent' -d 'Agent to use'
complete -c opencode -n '__fish_seen_subcommand_from mini; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt prompt' -f -a '--prompt' -d 'Prompt to use'
complete -c opencode -n '__fish_seen_subcommand_from run' -f
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt -s c continue no-continue' -l continue -s c -d 'Continue the last session'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt -s c continue no-continue' -l no-continue -d 'Disable continue'
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt -s s session; or contains -- (commandline -poc)[-1] --session -s; end' -l session -s s -d 'Session ID to continue, or to create if it does not exist' -r -f
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt fork no-fork' -l fork -d 'Fork the session before continuing'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt fork no-fork' -l no-fork -d 'Disable fork'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt -s w worktree' -l worktree -s w -d 'Start a new session in a new git worktree, optionally with this name'
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt -s m model; or contains -- (commandline -poc)[-1] --model -m; end' -l model -s m -d 'Model to use in the format provider/model#variant' -r -f
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt agent; or contains -- (commandline -poc)[-1] --agent; end' -l agent -d 'Agent to use' -r -f
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt format; or contains -- (commandline -poc)[-1] --format; end' -l format -d 'Output format' -r -f -a 'default json'
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt -s f file; or contains -- (commandline -poc)[-1] --file -f; end' -l file -s f -d 'File to attach to the message' -r -f
complete -c opencode -n '__fish_seen_subcommand_from run; and begin; not __fish_contains_opt title; or contains -- (commandline -poc)[-1] --title; end' -l title -d 'Session title' -r -f
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt archived no-archived' -l archived -d 'Create the session archived so it stays out of session lists (useful for scripted or CI runs)'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt archived no-archived' -l no-archived -d 'Disable archived'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt thinking no-thinking' -l thinking -d 'Show thinking blocks'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt thinking no-thinking' -l no-thinking -d 'Disable thinking'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt auto no-auto' -l auto -d 'Auto-approve permissions that are not explicitly denied'
complete -c opencode -n '__fish_seen_subcommand_from run; and not __fish_contains_opt auto no-auto' -l no-auto -d 'Disable auto'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--continue' -d 'Continue the last session'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s c continue no-continue' -f -a '--no-continue' -d 'Disable continue'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s s session' -f -a '--session' -d 'Session ID to continue, or to create if it does not exist'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt fork no-fork' -f -a '--fork' -d 'Fork the session before continuing'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt fork no-fork' -f -a '--no-fork' -d 'Disable fork'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s w worktree' -f -a '--worktree' -d 'Start a new session in a new git worktree, optionally with this name'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s m model' -f -a '--model' -d 'Model to use in the format provider/model#variant'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt agent' -f -a '--agent' -d 'Agent to use'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt format' -f -a '--format' -d 'Output format'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s f file' -f -a '--file' -d 'File to attach to the message'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt title' -f -a '--title' -d 'Session title'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt archived no-archived' -f -a '--archived' -d 'Create the session archived so it stays out of session lists (useful for scripted or CI runs)'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt archived no-archived' -f -a '--no-archived' -d 'Disable archived'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt thinking no-thinking' -f -a '--thinking' -d 'Show thinking blocks'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt thinking no-thinking' -f -a '--no-thinking' -d 'Disable thinking'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt auto no-auto' -f -a '--auto' -d 'Auto-approve permissions that are not explicitly denied'
complete -c opencode -n '__fish_seen_subcommand_from run; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt auto no-auto' -f -a '--no-auto' -d 'Disable auto'
complete -c opencode -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from list delete export import' -f
complete -c opencode -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from list delete export import' -f -a 'list' -d 'List top-level sessions in the current project, newest first'
complete -c opencode -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from list delete export import' -f -a 'delete' -d 'Delete a session and its child sessions'
complete -c opencode -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from list delete export import' -f -a 'export' -d 'Export session data as JSON'
complete -c opencode -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from list delete export import' -f -a 'import' -d 'Import session data from a JSON file or URL'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from list' -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from list; and begin; not __fish_contains_opt -s n max-count; or contains -- (commandline -poc)[-1] --max-count -n; end' -l max-count -s n -d 'Limit to N most recent sessions (default: 100)' -r -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from list; and begin; not __fish_contains_opt format; or contains -- (commandline -poc)[-1] --format; end' -l format -d 'Output format' -r -f -a 'table json'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from list; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s n max-count' -f -a '--max-count' -d 'Limit to N most recent sessions (default: 100)'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from list; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt format' -f -a '--format' -d 'Output format'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from delete' -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from export' -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from export; and not __fish_contains_opt sanitize no-sanitize' -l sanitize -d 'Redact sensitive transcript and file data'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from export; and not __fish_contains_opt sanitize no-sanitize' -l no-sanitize -d 'Disable sanitize'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from export; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt sanitize no-sanitize' -f -a '--sanitize' -d 'Redact sensitive transcript and file data'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from export; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt sanitize no-sanitize' -f -a '--no-sanitize' -d 'Disable sanitize'
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from import' -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from import; and begin; not __fish_contains_opt directory; or contains -- (commandline -poc)[-1] --directory; end' -l directory -d 'Directory in which to import the session' -r -f
complete -c opencode -n '__fish_seen_subcommand_from session; and __fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt directory' -f -a '--directory' -d 'Directory in which to import the session'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'start' -d 'Start the background server'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'restart' -d 'Restart the background server'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'status' -d 'Show background server status'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'stop' -d 'Stop the background server'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'get' -d 'Get service configuration'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'set' -d 'Set service configuration'
complete -c opencode -n '__fish_seen_subcommand_from service; and not __fish_seen_subcommand_from start restart status stop get set unset' -f -a 'unset' -d 'Unset service configuration'
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from start' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from restart' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from status' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from stop' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from get' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from set' -f
complete -c opencode -n '__fish_seen_subcommand_from service; and __fish_seen_subcommand_from unset' -f
complete -c opencode -n '__fish_seen_subcommand_from reload' -f
complete -c opencode -n '__fish_seen_subcommand_from pair' -f
complete -c opencode -n '__fish_seen_subcommand_from pair; and begin; not __fish_contains_opt url; or contains -- (commandline -poc)[-1] --url; end' -l url -d 'Use an external HTTP(S) server URL in pairing links' -r -f
complete -c opencode -n '__fish_seen_subcommand_from pair; and not __fish_contains_opt remote no-remote' -l remote -d 'Pair through the OpenTunnel remote address, enabling remote access if needed (exposes the server to the internet)'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not __fish_contains_opt remote no-remote' -l no-remote -d 'Disable remote'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not __fish_contains_opt -s y yes no-yes' -l yes -s y -d 'Accept exposing the server to the internet when --remote enables remote access for the first time (required without an interactive terminal)'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not __fish_contains_opt -s y yes no-yes' -l no-yes -d 'Disable yes'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt url' -f -a '--url' -d 'Use an external HTTP(S) server URL in pairing links'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt remote no-remote' -f -a '--remote' -d 'Pair through the OpenTunnel remote address, enabling remote access if needed (exposes the server to the internet)'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt remote no-remote' -f -a '--no-remote' -d 'Disable remote'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s y yes no-yes' -f -a '--yes' -d 'Accept exposing the server to the internet when --remote enables remote access for the first time (required without an interactive terminal)'
complete -c opencode -n '__fish_seen_subcommand_from pair; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt -s y yes no-yes' -f -a '--no-yes' -d 'Disable yes'
complete -c opencode -n '__fish_seen_subcommand_from serve' -f
complete -c opencode -n '__fish_seen_subcommand_from serve; and begin; not __fish_contains_opt hostname; or contains -- (commandline -poc)[-1] --hostname; end' -l hostname -r -f
complete -c opencode -n '__fish_seen_subcommand_from serve; and begin; not __fish_contains_opt port; or contains -- (commandline -poc)[-1] --port; end' -l port -r -f
complete -c opencode -n '__fish_seen_subcommand_from serve; and begin; not __fish_contains_opt cors; or contains -- (commandline -poc)[-1] --cors; end' -l cors -d 'Additional allowed CORS origin (repeat for multiple origins)' -r -f
complete -c opencode -n '__fish_seen_subcommand_from serve; and not __fish_contains_opt service no-service' -l service
complete -c opencode -n '__fish_seen_subcommand_from serve; and not __fish_contains_opt service no-service' -l no-service
complete -c opencode -n '__fish_seen_subcommand_from serve; and not __fish_contains_opt stdio no-stdio' -l stdio
complete -c opencode -n '__fish_seen_subcommand_from serve; and not __fish_contains_opt stdio no-stdio' -l no-stdio
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt hostname' -f -a '--hostname'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt port' -f -a '--port'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt cors' -f -a '--cors' -d 'Additional allowed CORS origin (repeat for multiple origins)'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt service no-service' -f -a '--service'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt service no-service' -f -a '--no-service'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt stdio no-stdio' -f -a '--stdio'
complete -c opencode -n '__fish_seen_subcommand_from serve; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt stdio no-stdio' -f -a '--no-stdio'

###-end-opencode-completions-###
