/**
 * Shell completion script management
 */

import { BashCompletion } from "./bash"
import { ZshCompletion } from "./zsh"
import { FishCompletion } from "./fish"
import { PowerShellCompletion } from "./powershell"

export namespace Completion {
  export type Shell = "bash" | "zsh" | "fish" | "powershell"

  export function generate(shell: Shell): string {
    switch (shell) {
      case "bash":
        return BashCompletion.generate()
      case "zsh":
        return ZshCompletion.generate()
      case "fish":
        return FishCompletion.generate()
      case "powershell":
        return PowerShellCompletion.generate()
      default:
        throw new Error(`Unsupported shell: ${shell}`)
    }
  }

  export function getInstallInstructions(shell: Shell): string {
    switch (shell) {
      case "bash":
        return `
To enable bash completion, add this to your ~/.bashrc:
  eval "$(opencode completion bash)"

Then reload your shell:
  source ~/.bashrc
`
      case "zsh":
        return `
To enable zsh completion, add this to your ~/.zshrc:
  eval "$(opencode completion zsh)"

Then reload your shell:
  source ~/.zshrc
`
      case "fish":
        return `
To enable fish completion, run:
  opencode completion fish > ~/.config/fish/completions/opencode.fish

The completion will be automatically loaded in new shell sessions.
`
      case "powershell":
        return `
To enable PowerShell completion, add this to your PowerShell profile:
  opencode completion powershell | Out-String | Invoke-Expression

To edit your profile, run:
  notepad $PROFILE

Then restart your PowerShell session.
`
      default:
        return ""
    }
  }
}
