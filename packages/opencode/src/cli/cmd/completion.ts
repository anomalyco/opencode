import type { Argv } from "yargs"
import { cmd } from "./cmd"

export type ShellType = "bash" | "fish" | "zsh"

/**
 * Auto-detect the user's shell from the $SHELL environment variable.
 * Falls back to "bash" if detection fails.
 */
export function detectShell(shellEnv?: string): ShellType {
  if (!shellEnv) return "bash"
  const basename = shellEnv.split("/").pop()?.toLowerCase() ?? ""
  if (basename.includes("fish")) return "fish"
  if (basename.includes("zsh")) return "zsh"
  return "bash"
}

const bashScript = `###-begin-opencode-completions-###
#
# opencode command completion script for bash
#
# Installation: opencode completion bash > ~/.bashrc
#    or opencode completion bash >> ~/.bash_profile on OSX.
#
_opencode_yargs_completions()
{
    local cur_word args type_list

    cur_word="\${COMP_WORDS[COMP_CWORD]}"
    args=("\${COMP_WORDS[@]}")

    # ask yargs to generate completions.
    mapfile -t type_list < <(opencode --get-yargs-completions "\${args[@]}" | grep -vxF '\$0' | grep -vxF _generate_completions)
    mapfile -t COMPREPLY < <(compgen -W "$( printf '%q ' "\${type_list[@]}" )" -- "\${cur_word}")

    # if no match was found, fall back to filename completion
    if [ \${#COMPREPLY[@]} -eq 0 ]; then
      COMPREPLY=()
    fi

    return 0
}
complete -o bashdefault -o default -F _opencode_yargs_completions opencode
###-end-opencode-completions-###
`

const fishScript = `###-begin-opencode-completions-###
#
# opencode command completion script for fish
#
# Installation: opencode completion fish > ~/.config/fish/completions/opencode.fish
#
# Dynamic completions: calls \`opencode --get-yargs-completions\` at completion time
# with SHELL=zsh to get name:description pairs, so new subcommands/options are
# picked up automatically when opencode is updated.
#

function __opencode_yargs_completions
    # Grab the current command-line tokens and the token being typed
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)

    # Ask yargs for completions using the zsh output format (name:description pairs)
    set -l completions (SHELL=zsh command opencode --get-yargs-completions $tokens $current 2>/dev/null)

    for completion in $completions
        # Filter out yargs internal placeholders
        if test "$completion" = '$0'
            continue
        end
        if test "$completion" = '_generate_completions'
            continue
        end

        # Split on first colon to extract name and description
        set -l parts (string split -m 1 ':' -- $completion)
        if set -q parts[2]
            printf '%s\\t%s\\n' $parts[1] $parts[2]
        else
            printf '%s\\n' $parts[1]
        end
    end
end

complete -c opencode -f -a '(__opencode_yargs_completions)'
###-end-opencode-completions-###
`

const zshScript = `###-begin-opencode-completions-###
#
# opencode command completion script for zsh
#
# Installation: opencode completion zsh > ~/.zsh/completion/_opencode
#    or add to your fpath and run: autoload -Uz _opencode && compdef _opencode opencode
#

#compdef opencode

_opencode_yargs_completions() {
    local -a completions

    # Ask yargs for completions in zsh format (name:description pairs)
    completions=(\${(f)"\$(SHELL=zsh opencode --get-yargs-completions \${words[1,CURRENT]} 2>/dev/null)"})

    # Filter out yargs internal placeholders
    completions=(\${completions[@]//\\\$0/})
    completions=(\${completions[@]//_generate_completions/})

    _describe 'opencode' completions
}

_opencode_yargs_completions
###-end-opencode-completions-###
`

/**
 * Return the completion script string for the given shell type.
 */
export function completionScript(shell: ShellType): string {
  switch (shell) {
    case "bash":
      return bashScript
    case "fish":
      return fishScript
    case "zsh":
      return zshScript
  }
}

export const CompletionCommand = cmd({
  command: "completion",
  describe: "generate shell completion script",
  builder: (yargs: Argv) =>
    yargs.option("shell", {
      type: "string",
      describe: "shell type (auto-detected from $SHELL if omitted)",
      choices: ["bash", "fish", "zsh"] as const,
    }),
  handler: async (args) => {
    const shell = (args.shell as ShellType | undefined) ?? detectShell(process.env.SHELL)
    process.stdout.write(completionScript(shell))
  },
})