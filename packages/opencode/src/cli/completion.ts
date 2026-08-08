import { UI } from "./ui"
import { EOL } from "os"

const completionFishTemplate = `# opencode fish completion
complete -f -c opencode -a '(opencode --get-yargs-completions (commandline -o)[2..-1])'`

const completionBashTemplate = `###-begin-{{app_name}}-completions-###
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
###-end-{{app_name}}-completions-###`

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
  local si=\$IFS
  IFS=\$'\\n' reply=(\$(COMP_CWORD="\$((CURRENT-1))" COMP_LINE="\$BUFFER" COMP_POINT="\$CURSOR" {{app_path}} --get-yargs-completions "\${words[@]}"))
  IFS=\$si
  if [[ \${#reply} -gt 0 ]]; then
    _describe 'values' reply
  else
    _default
  fi
}
if [[ "'\${zsh_eval_context[-1]}" == "loadautofunc" ]]; then
  _{{app_name}}_yargs_completions "\$@"
else
  compdef _{{app_name}}_yargs_completions {{app_name}}
fi
###-end-{{app_name}}-completions-###`

export async function showCompletionScript(shell?: string) {
  const args = process.argv.slice(2)
  const shellArg = args.find(arg => ["bash", "zsh", "fish"].includes(arg))
  const targetShell = shell || shellArg

  // Get the command name from the first non-flag argument
  let cmd = "completion"
  for (const arg of args) {
    if (!arg.startsWith("-") && arg !== "completion" && !["bash", "zsh", "fish"].includes(arg)) {
      cmd = arg
      break
    }
  }

  // Use the script name
  const $0 = process.argv[1] || "opencode"

  let script = ""
  let name = "opencode"

  if (targetShell === "fish") {
    script = completionFishTemplate
  } else if (targetShell === "zsh") {
    script = completionZshTemplate
  } else {
    // Default to bash
    script = completionBashTemplate
  }

  // Replace template variables
  script = script.replace(/{{app_name}}/g, name)
  script = script.replace(/{{completion_command}}/g, cmd)
  script = script.replace(/{{app_path}}/g, $0)

  // Output the script
  process.stdout.write(script + EOL)
}