import { basename } from "path"

const completionShTemplate = `###-begin-{{app_name}}-completions-###
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

const completionZshTemplate = `#compdef {{app_name}}
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

const completionFishTemplate = `###-begin-{{app_name}}-completions-###
#
# yargs command completion script
#
# Installation: {{app_path}} {{completion_command}} > ~/.config/fish/completions/{{app_name}}.fish
#
complete -f -c {{app_name}} -a '({{app_path}} --get-yargs-completions (commandline -o)[2..-1])'
###-end-{{app_name}}-completions-###
`

const SHELLS = ["bash", "zsh", "fish"] as const

export type CompletionShell = (typeof SHELLS)[number]

export function isCompletionShell(s: string | undefined): s is CompletionShell {
  return !!s && (SHELLS as readonly string[]).includes(s)
}

// yargs 18 only ships bash/zsh templates and picks them from $SHELL, ignoring the
// shell positional arg. Generate the script ourselves so `completion fish` (and
// `completion zsh` under a bash $SHELL) emit the right template.
export function generateCompletionScript(
  shell: CompletionShell,
  appPath: string,
  appName: string,
): string {
  const template =
    shell === "fish"
      ? completionFishTemplate
      : shell === "zsh"
        ? completionZshTemplate
        : completionShTemplate
  return template
    .replace(/{{app_name}}/g, appName)
    .replace(/{{completion_command}}/g, "completion")
    .replace(/{{app_path}}/g, appPath)
}

export function generateCompletionScriptForArgs(shell: CompletionShell): string {
  const appPath = process.argv[1]
  return generateCompletionScript(shell, appPath, basename(appPath))
}
