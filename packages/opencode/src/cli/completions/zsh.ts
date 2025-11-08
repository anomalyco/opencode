/**
 * Zsh shell completion script generator for OpenCode CLI
 */

export namespace ZshCompletion {
  export function generate(): string {
    return `#compdef opencode
# OpenCode zsh completion script
# Add to your ~/.zshrc:
#   eval "$(opencode completion zsh)"

_opencode() {
    local -a commands auth_commands debug_commands mcp_commands
    local -a run_opts serve_opts common_opts formats log_levels providers models agents

    commands=(
        'run:run opencode with a message'
        'spawn:start the TUI server and client locally'
        'attach:connect a TUI client to a running server'
        'serve:start just the server component'
        'auth:manage API credentials'
        'models:list and inspect available models'
        'agent:manage AI agents'
        'config:configuration management'
        'debug:diagnostic tools'
        'mcp:Model Context Protocol management'
        'export:export sessions and data'
        'import:import external data'
        'stats:display session statistics'
        'upgrade:update OpenCode to latest version'
        'web:start web interface'
        'github:GitHub integration'
        'acp:Agent Client Protocol support'
        'generate:code generation utilities'
        'thread:thread management'
        'completion:generate shell completion script'
    )

    auth_commands=(
        'login:authenticate with a provider'
        'logout:remove credentials'
        'list:show configured providers'
    )

    debug_commands=(
        'config:inspect configuration'
        'lsp:debug Language Server Protocol'
        'file:analyze files'
        'rg:test ripgrep'
        'snapshot:create snapshots'
    )

    mcp_commands=(
        'install:install MCP servers'
        'list:list installed MCP servers'
    )

    common_opts=(
        '(- *)'{-h,--help}'[show help]'
        '(- *)'{-v,--version}'[show version]'
        '--print-logs[print logs to stderr]'
        '--log-level[set log level]:level:(DEBUG INFO WARN ERROR)'
    )

    run_opts=(
        '--command[command to run]:command:'
        {-c,--continue}'[continue the last session]'
        {-s,--session}'[session id to continue]:session:'
        '--share[share the session]'
        {-m,--model}'[model to use]:model:'
        '--agent[agent to use]:agent:'
        '--format[output format]:format:(default json)'
        {-f,--file}'[file(s) to attach]:file:_files'
        '--title[title for the session]:title:'
        '--attach[attach to running server]:url:'
        '--port[port for local server]:port:'
    )

    serve_opts=(
        '--port[server port]:port:'
        '--hostname[server hostname]:hostname:'
        '--no-tui[disable TUI]'
    )

    formats=('default' 'json')
    log_levels=('DEBUG' 'INFO' 'WARN' 'ERROR')
    providers=('anthropic' 'openai' 'google' 'bedrock')
    models=(
        'anthropic/claude-sonnet-4.5'
        'anthropic/claude-opus-4'
        'openai/gpt-4'
        'openai/gpt-4o'
    )
    agents=('general' 'build' 'plan')

    local curcontext=\${curcontext} state line
    typeset -A opt_args

    _arguments -C \\
        '\${common_opts[@]}' \\
        '1: :->command' \\
        '*::arg:->args'

    case \${state} in
        command)
            _describe -t commands 'opencode commands' commands
            ;;
        args)
            case \${line[1]} in
                run)
                    _arguments \\
                        '\${run_opts[@]}' \\
                        '\${common_opts[@]}' \\
                        '*:message:'
                    ;;
                spawn)
                    _arguments \\
                        '--port[port for local server]:port:' \\
                        '\${common_opts[@]}'
                    ;;
                attach)
                    _arguments \\
                        '--url[server URL]:url:' \\
                        '\${common_opts[@]}'
                    ;;
                serve)
                    _arguments \\
                        '\${serve_opts[@]}' \\
                        '\${common_opts[@]}'
                    ;;
                auth)
                    local -a auth_args
                    auth_args=(
                        '1: :->auth_command'
                        '*::arg:->auth_args'
                    )
                    _arguments -C "\${auth_args[@]}"
                    case \${state} in
                        auth_command)
                            _describe -t auth-commands 'auth commands' auth_commands
                            ;;
                        auth_args)
                            case \${line[1]} in
                                login)
                                    _arguments '--provider[authentication provider]:provider:(anthropic openai google bedrock)'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                debug)
                    _describe -t debug-commands 'debug commands' debug_commands
                    ;;
                mcp)
                    _describe -t mcp-commands 'mcp commands' mcp_commands
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh fish powershell)'
                    ;;
                models|agent|config|export|import|stats|upgrade|web|github|acp|generate|thread)
                    _arguments '\${common_opts[@]}'
                    ;;
            esac
            ;;
    esac
}

_opencode "$@"
`.trim()
  }
}
