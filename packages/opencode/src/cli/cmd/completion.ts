import { EOL } from "os"
import { cmd } from "./cmd"

// Shell completion scripts. Templates mirror yargs' own generation
// (lib/completion-templates.ts, MIT) but select the template from the
// positional shell argument. yargs picks a template from $SHELL only,
// so `opencode completion fish` prints a bash or zsh script when $SHELL
// does not name fish. The fish template below is the one yargs uses on
// main (https://github.com/yargs/yargs/pull/2568), unreleased as of
// yargs 18.2.0.

const bashTemplate = `###-begin-{{app_name}}-completions-###
#
# yargs command completion script
#
# Installation: {{app_path}} {{completion_command}} >> ~/.bashrc
#    or {{app_path}} {{completion_command}} >> ~/.bash_profile on OSX.
#
_{{app_name}}_yargs_completions()
{
    local cur_word args type_list

    cur_word="\${COMP_WORDS[COMP_CWORD]}"
    args=("\${COMP_WORDS[@]}")

    # ask yargs to generate completions.
    # see https://stackoverflow.com/a/40944195/7080036 for the spaces-handling awk
    mapfile -t type_list < <({{app_path}} --get-yargs-completions "\${args[@]}")
    mapfile -t COMPREPLY < <(compgen -W "$( printf '%q ' "\${type_list[@]}" )" -- "\${cur_word}" |
        awk '/ / { print "\\""$0"\\"" } /^[^ ]+$/ { print $0 }')

    # if no match was found, fall back to filename completion
    if [ \${#COMPREPLY[@]} -eq 0 ]; then
      COMPREPLY=()
    fi

    return 0
}
complete -o bashdefault -o default -F _{{app_name}}_yargs_completions {{app_name}}
###-end-{{app_name}}-completions-###
`

const zshTemplate = `#compdef {{app_name}}
###-begin-{{app_name}}-completions-###
#
# yargs command completion script
#
# Installation: {{app_path}} {{completion_command}} >> ~/.zshrc
#    or {{app_path}} {{completion_command}} >> ~/.zprofile on OSX.
#
_{{app_name}}_yargs_completions()
{
  local reply
  local si=$IFS
  IFS=$'\n' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" {{app_path}} --get-yargs-completions "\${words[@]}"))
  IFS=$si
  if [[ \${#reply} -gt 0 ]]; then
    _describe 'values' reply
  else
    _default
  fi
}
if [[ "'\${zsh_eval_context[-1]}" == "loadautofunc" ]]; then
  _{{app_name}}_yargs_completions "$@"
else
  compdef _{{app_name}}_yargs_completions {{app_name}}
fi
###-end-{{app_name}}-completions-###
`

const fishTemplate = `###-begin-{{app_name}}-completions-###
#
# yargs command completion script
#
# Installation: {{app_path}} {{completion_command}} > ~/.config/fish/completions/{{app_name}}.fish
#
complete -f -c {{app_name}} -a '({{app_path}} --get-yargs-completions (commandline -o)[2..-1])'
###-end-{{app_name}}-completions-###
`

function templateForShell(shell: string): string {
  if (shell === "fish") return fishTemplate
  if (shell === "zsh") return zshTemplate
  return bashTemplate
}

export function detectShell(shellEnv: string | undefined): string {
  const shell = (shellEnv ?? "").split("/").pop() ?? ""
  if (shell.includes("fish")) return "fish"
  if (shell.includes("zsh")) return "zsh"
  return "bash"
}

export function generateCompletionScript(shell: string): string {
  return templateForShell(shell)
    .replaceAll("{{app_name}}", "opencode")
    .replaceAll("{{completion_command}}", "completion")
    .replaceAll("{{app_path}}", "opencode")
}

export const CompletionCommand = cmd({
  command: "completion [shell]",
  describe: "generate shell completion script",
  builder: (yargs) =>
    yargs.positional("shell", {
      type: "string",
      describe: "shell to generate completions for (defaults to $SHELL, unknown values fall back to bash)",
    }),
  handler: (args) => {
    const shell = args.shell ?? detectShell(process.env.SHELL)
    process.stdout.write(generateCompletionScript(shell))
    process.stdout.write(EOL)
  },
})
