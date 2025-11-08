import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Completion } from "../completions"

export const CompletionCommand = cmd({
  command: "completion [shell]",
  describe: "generate shell completion script",
  builder: (yargs: Argv) => {
    return yargs
      .positional("shell", {
        describe: "shell type",
        type: "string",
        choices: ["bash", "zsh", "fish", "powershell"] as const,
      })
      .option("install", {
        describe: "show installation instructions",
        type: "boolean",
        default: false,
      })
      .example("opencode completion bash", "Generate bash completion script")
      .example("opencode completion zsh --install", "Show zsh installation instructions")
      .example('eval "$(opencode completion bash)"', "Install bash completions")
  },
  handler: async (args) => {
    if (!args.shell) {
      UI.error("Please specify a shell: bash, zsh, fish, or powershell")
      UI.println()
      UI.println("Examples:")
      UI.println("  opencode completion bash")
      UI.println("  opencode completion zsh")
      UI.println("  opencode completion fish")
      UI.println("  opencode completion powershell")
      UI.println()
      UI.println("To enable completions, add to your shell config:")
      UI.println("  bash:       eval \"$(opencode completion bash)\"")
      UI.println("  zsh:        eval \"$(opencode completion zsh)\"")
      UI.println("  fish:       opencode completion fish > ~/.config/fish/completions/opencode.fish")
      UI.println("  powershell: opencode completion powershell | Out-String | Invoke-Expression")
      process.exit(1)
    }

    const shell = args.shell as Completion.Shell

    if (args.install) {
      UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `Shell Completion Installation - ${shell}`)
      UI.println(Completion.getInstallInstructions(shell))
      return
    }

    // Output the completion script to stdout (not stderr)
    const script = Completion.generate(shell)
    process.stdout.write(script + "\n")
  },
})
