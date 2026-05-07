import type { Argv } from "yargs"
import { cmd } from "./cmd"
import path from "path"

export function detectShell(shellEnv: string | undefined): "bash" | "fish" {
  if (!shellEnv) return "bash"
  if (path.basename(shellEnv) === "fish") return "fish"
  return "bash"
}

function bashScript() {
  // Matches the official yargs v18 completion script with mapfile for proper
  // handling of completions containing spaces or special characters.
  // Bash does not support tab-separated descriptions natively (compgen -W
  // breaks on tabs), so completions are plain command/option names only.
  return `###-begin-opencode-completions-###
#
# yargs command completion script
#
# Installation: opencode completion --shell bash >> ~/.bashrc
#    or opencode completion --shell bash >> ~/.bash_profile on OSX.
#
_opencode_yargs_completions()
{
    local cur_word args type_list

    cur_word="\${COMP_WORDS[COMP_CWORD]}"
    args=("\${COMP_WORDS[@]}")

    # ask yargs to generate completions, filtering out internal placeholders
    # see https://stackoverflow.com/a/40944195/7080036 for the spaces-handling awk
    mapfile -t type_list < <(opencode --get-yargs-completions "\${args[@]}" | grep -vxF '\$0')
    mapfile -t COMPREPLY < <(compgen -W "$( printf '%q ' "\${type_list[@]}" )" -- "\${cur_word}" |
        awk '/ / { print "\\""\$0"\\"" } /^[^ ]+\$/ { print \$0 }')

    # if no match was found, fall back to filename completion
    if [ \${#COMPREPLY[@]} -eq 0 ]; then
      COMPREPLY=()
    fi

    return 0
}
complete -o bashdefault -o default -F _opencode_yargs_completions opencode
###-end-opencode-completions-###
`
}

function fishScript() {
  return `###-begin-opencode-completions-###
#
# Fish shell completions for opencode
#
# Installation:
#   opencode completion --shell fish | source                                    # Current session
#   opencode completion --shell fish > ~/.config/fish/completions/opencode.fish  # Permanent
#

function __opencode_yargs_completions
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)

    # Ask yargs to generate completions.
    # Setting SHELL=zsh triggers yargs' built-in "name:description" output format.
    # We parse the colon-separated pairs and convert to Fish's tab-separated format.
    set -l completions (SHELL=zsh command opencode --get-yargs-completions $tokens $current 2>/dev/null)

    for completion in $completions
        # Parse yargs "name:description" format into Fish's tab-separated format.
        # Yargs escapes literal colons in names as "\\:" so we split on the first
        # unescaped colon only. Fish's complete builtin expects "name\\tdescription"
        # where \\t is a real tab character -- printf handles this correctly.
        set -l parts (string split -m 1 ':' -- $completion)

        # Filter out yargs internal placeholders (matched after parsing since
        # SHELL=zsh output includes descriptions like "$0:start opencode tui")
        switch $parts[1]
            case '$0' '_generate_completions'
                continue
        end

        if test (count $parts) -gt 1 -a -n "$parts[2]"
            printf '%s\\t%s\\n' $parts[1] $parts[2]
        else
            echo $completion
        end
    end
end

complete -c opencode -f -a '(__opencode_yargs_completions)'
###-end-opencode-completions-###
`
}

export function completionScript(shell: "bash" | "fish") {
  if (shell === "bash") return bashScript()
  if (shell === "fish") return fishScript()
  const _exhaustive: never = shell
  throw new Error(`Unsupported shell: ${_exhaustive}`)
}

export const CompletionCommand = cmd({
  command: "completion",
  describe: "generate shell completion script",
  builder: (yargs: Argv) =>
    yargs.option("shell", {
      type: "string",
      describe: "shell type (auto-detected from $SHELL if omitted)",
      choices: ["bash", "fish"] as const,
    }),
  handler: async (args) => {
    const shell = args.shell ?? detectShell(process.env.SHELL)
    process.stdout.write(completionScript(shell))
  },
})
