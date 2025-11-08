/**
 * Bash shell completion script generator for OpenCode CLI
 */

export namespace BashCompletion {
  export function generate(): string {
    return `
# OpenCode bash completion script
# Add to your ~/.bashrc:
#   eval "$(opencode completion bash)"

_opencode_completion() {
    local cur prev words cword
    _init_completion || return

    local commands="run spawn attach serve auth models agent config debug mcp export import stats upgrade web github acp generate thread completion"

    # Sub-commands for specific commands
    local auth_commands="login logout list"
    local debug_commands="config lsp file rg snapshot"
    local mcp_commands="install list"

    # Common options
    local common_opts="--help -h --version -v --print-logs --log-level"

    # Run command options
    local run_opts="--command --continue -c --session -s --share --model -m --agent --format --file -f --title --attach --port"

    # Serve command options
    local serve_opts="--port --hostname --no-tui"

    # Auth command options
    local auth_opts="--provider"

    case "${COMP_CWORD}" in
        1)
            # First argument: complete main commands
            COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
            ;;
        2)
            # Second argument: complete sub-commands based on main command
            case "${prev}" in
                auth)
                    COMPREPLY=($(compgen -W "${auth_commands}" -- "${cur}"))
                    ;;
                debug)
                    COMPREPLY=($(compgen -W "${debug_commands}" -- "${cur}"))
                    ;;
                mcp)
                    COMPREPLY=($(compgen -W "${mcp_commands}" -- "${cur}"))
                    ;;
                completion)
                    COMPREPLY=($(compgen -W "bash zsh fish powershell" -- "${cur}"))
                    ;;
                run|spawn|attach|serve)
                    # For these commands, suggest options
                    case "${prev}" in
                        run)
                            COMPREPLY=($(compgen -W "${run_opts} ${common_opts}" -- "${cur}"))
                            ;;
                        serve)
                            COMPREPLY=($(compgen -W "${serve_opts} ${common_opts}" -- "${cur}"))
                            ;;
                        *)
                            COMPREPLY=($(compgen -W "${common_opts}" -- "${cur}"))
                            ;;
                    esac
                    ;;
            esac
            ;;
        *)
            # For other positions, complete based on the main command
            local main_cmd="\${words[1]}"

            # Handle option values
            case "${prev}" in
                --file|-f)
                    # Complete file paths
                    COMPREPLY=($(compgen -f -- "${cur}"))
                    ;;
                --agent)
                    # Complete agent names (would need to query opencode)
                    COMPREPLY=($(compgen -W "general build plan" -- "${cur}"))
                    ;;
                --format)
                    COMPREPLY=($(compgen -W "default json" -- "${cur}"))
                    ;;
                --log-level)
                    COMPREPLY=($(compgen -W "DEBUG INFO WARN ERROR" -- "${cur}"))
                    ;;
                --provider)
                    COMPREPLY=($(compgen -W "anthropic openai google bedrock" -- "${cur}"))
                    ;;
                --model|-m)
                    # Could query available models, but for now suggest common ones
                    COMPREPLY=($(compgen -W "anthropic/claude-sonnet-4.5 anthropic/claude-opus-4 openai/gpt-4 openai/gpt-4o" -- "${cur}"))
                    ;;
                *)
                    # Default to showing options for the main command
                    case "${main_cmd}" in
                        run)
                            COMPREPLY=($(compgen -W "${run_opts} ${common_opts}" -- "${cur}"))
                            ;;
                        serve)
                            COMPREPLY=($(compgen -W "${serve_opts} ${common_opts}" -- "${cur}"))
                            ;;
                        auth)
                            if [[ "${words[2]}" == "login" ]]; then
                                COMPREPLY=($(compgen -W "${auth_opts}" -- "${cur}"))
                            else
                                COMPREPLY=($(compgen -W "${common_opts}" -- "${cur}"))
                            fi
                            ;;
                        *)
                            COMPREPLY=($(compgen -W "${common_opts}" -- "${cur}"))
                            ;;
                    esac
                    ;;
            esac
            ;;
    esac
}

complete -F _opencode_completion opencode
`.trim()
  }
}
