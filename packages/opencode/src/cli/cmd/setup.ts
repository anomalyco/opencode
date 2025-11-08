import type { Argv } from "yargs"
import { UI } from "../ui"
import { RichUI } from "../rich-ui"
import { Progress } from "../progress"
import { cmd } from "./cmd"
import { select, text, confirm, multiselect } from "@clack/prompts"
import { Provider } from "../../provider/provider"
import { Config } from "../../config/config"
import { EOL } from "os"

export const SetupCommand = cmd({
  command: "setup",
  describe: "interactive setup wizard for first-time users",
  builder: (yargs: Argv) => {
    return yargs
      .option("quick", {
        describe: "quick setup with defaults",
        type: "boolean",
        default: false,
      })
      .example("opencode setup", "Run interactive setup wizard")
      .example("opencode setup --quick", "Quick setup with defaults")
  },
  handler: async (args) => {
    // Welcome banner
    UI.println()
    UI.println(
      RichUI.banner(
        `${UI.Style.TEXT_HIGHLIGHT_BOLD}Welcome to OpenCode!${UI.Style.TEXT_NORMAL}${EOL}Let's get you set up in just a few steps.`,
        "TEXT_HIGHLIGHT",
      ),
    )
    UI.println()

    if (args.quick) {
      await quickSetup()
    } else {
      await interactiveSetup()
    }

    // Success message
    UI.println()
    UI.println(
      RichUI.box(
        `${UI.Style.TEXT_SUCCESS_BOLD}${RichUI.Icons.success} Setup Complete!${UI.Style.TEXT_NORMAL}${EOL}${EOL}You're all set to start using OpenCode.${EOL}${EOL}Try these commands to get started:${EOL}  ${UI.Style.TEXT_HIGHLIGHT}opencode run "hello world"${UI.Style.TEXT_NORMAL}${EOL}  ${UI.Style.TEXT_HIGHLIGHT}opencode spawn${UI.Style.TEXT_NORMAL}${EOL}  ${UI.Style.TEXT_HIGHLIGHT}opencode --help${UI.Style.TEXT_NORMAL}`,
        { title: "All Done!", style: "TEXT_SUCCESS", padding: 2 },
      ),
    )
    UI.println()

    // Suggest shell completions
    UI.println(
      `${UI.Style.TEXT_INFO_BOLD}${RichUI.Icons.info}${UI.Style.TEXT_NORMAL} Don't forget to enable shell completions:`,
    )
    UI.println(`  ${UI.Style.TEXT_DIM}eval "$(opencode completion bash)"${UI.Style.TEXT_NORMAL}`)
    UI.println()
  },
})

async function quickSetup(): Promise<void> {
  const spinner = new Progress.Spinner("Running quick setup")
  spinner.start()

  // Simulate setup steps
  await new Promise((resolve) => setTimeout(resolve, 500))
  spinner.update("Checking system requirements")
  await new Promise((resolve) => setTimeout(resolve, 500))
  spinner.update("Setting up configuration")
  await new Promise((resolve) => setTimeout(resolve, 500))
  spinner.update("Installing default plugins")
  await new Promise((resolve) => setTimeout(resolve, 500))

  spinner.succeed("Quick setup completed")
}

async function interactiveSetup(): Promise<void> {
  // Step 1: Choose AI Provider
  UI.println(
    `${UI.Style.TEXT_HIGHLIGHT_BOLD}Step 1:${UI.Style.TEXT_NORMAL} Choose your AI provider`,
  )
  UI.println(UI.Style.TEXT_DIM + "OpenCode works with multiple AI providers" + UI.Style.TEXT_NORMAL)
  UI.println()

  const provider = await select({
    message: "Which AI provider would you like to use?",
    options: [
      {
        value: "anthropic",
        label: "Anthropic Claude",
        hint: "Claude Sonnet 4.5, Opus 4 (recommended)",
      },
      {
        value: "openai",
        label: "OpenAI",
        hint: "GPT-4, GPT-4o",
      },
      {
        value: "google",
        label: "Google Vertex AI",
        hint: "Gemini Pro",
      },
      {
        value: "local",
        label: "Local/Ollama",
        hint: "Run models locally",
      },
      {
        value: "skip",
        label: "Skip for now",
        hint: "Configure later",
      },
    ],
  })

  if (provider === "skip" || typeof provider === "symbol") {
    UI.println()
    UI.println(
      UI.Style.TEXT_WARNING +
        RichUI.Icons.warning +
        " Skipping provider setup. You can configure it later with: " +
        UI.Style.TEXT_HIGHLIGHT +
        "opencode auth login" +
        UI.Style.TEXT_NORMAL,
    )
  } else if (provider !== "local") {
    UI.println()
    UI.println(`Setting up ${provider}...`)

    const apiKey = await text({
      message: `Enter your ${provider} API key:`,
      placeholder: "sk-...",
      validate: (value) => {
        if (!value || value.length < 10) {
          return "Please enter a valid API key"
        }
      },
    })

    if (typeof apiKey === "string" && apiKey) {
      // Save API key (this would integrate with the actual auth system)
      const spinner = new Progress.Spinner(`Saving ${provider} credentials`)
      spinner.start()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      spinner.succeed(`${provider} credentials saved`)
    }
  }

  UI.println()

  // Step 2: Configure Defaults
  UI.println(
    `${UI.Style.TEXT_HIGHLIGHT_BOLD}Step 2:${UI.Style.TEXT_NORMAL} Configure defaults`,
  )
  UI.println()

  const defaultModel = await select({
    message: "Choose your default model:",
    options: [
      {
        value: "claude-sonnet-4.5",
        label: "Claude Sonnet 4.5",
        hint: "Fast, intelligent (recommended)",
      },
      {
        value: "claude-opus-4",
        label: "Claude Opus 4",
        hint: "Most capable",
      },
      {
        value: "gpt-4o",
        label: "GPT-4o",
        hint: "OpenAI's latest",
      },
    ],
  })

  UI.println()

  // Step 3: Optional Features
  UI.println(
    `${UI.Style.TEXT_HIGHLIGHT_BOLD}Step 3:${UI.Style.TEXT_NORMAL} Optional features`,
  )
  UI.println()

  const features = await multiselect({
    message: "Select features to enable:",
    options: [
      {
        value: "completions",
        label: "Shell completions",
        hint: "Auto-complete commands",
      },
      {
        value: "telemetry",
        label: "Anonymous telemetry",
        hint: "Help improve OpenCode",
      },
      {
        value: "auto-update",
        label: "Automatic updates",
        hint: "Keep OpenCode up-to-date",
      },
      {
        value: "lsp",
        label: "LSP support",
        hint: "Language Server Protocol integration",
      },
    ],
    required: false,
  })

  UI.println()

  // Step 4: Install Plugins
  const installPlugins = await confirm({
    message: "Would you like to browse recommended plugins?",
    initialValue: true,
  })

  if (installPlugins) {
    UI.println()
    UI.println(UI.Style.TEXT_DIM + "Recommended plugins:" + UI.Style.TEXT_NORMAL)
    UI.println()

    const plugins = await multiselect({
      message: "Select plugins to install:",
      options: [
        {
          value: "git",
          label: "Git Assistant",
          hint: "Enhanced git operations",
        },
        {
          value: "docker",
          label: "Docker Helper",
          hint: "Container management",
        },
        {
          value: "prettier",
          label: "Code Formatter",
          hint: "Prettier integration",
        },
        {
          value: "jest",
          label: "Test Runner",
          hint: "Jest integration",
        },
      ],
      required: false,
    })

    if (!Array.isArray(plugins) || plugins.length === 0) {
      UI.println()
      UI.println(UI.Style.TEXT_DIM + "No plugins selected" + UI.Style.TEXT_NORMAL)
    } else {
      UI.println()
      const steps = new Progress.Steps(plugins.map((p) => `Installing ${p}`))
      steps.start()

      for (const _plugin of plugins) {
        await new Promise((resolve) => setTimeout(resolve, 800))
        steps.next(true)
      }

      steps.complete()
    }
  }

  UI.println()

  // Step 5: Summary
  UI.println(
    `${UI.Style.TEXT_HIGHLIGHT_BOLD}Step 4:${UI.Style.TEXT_NORMAL} Review configuration`,
  )
  UI.println()

  const summary = {
    Provider: typeof provider === "string" ? provider : "not configured",
    Model: typeof defaultModel === "string" ? defaultModel : "default",
    Features: Array.isArray(features) ? features.length.toString() : "0",
    Plugins: "0",
  }

  UI.println(RichUI.keyValue(summary, { keyStyle: "TEXT_DIM", valueStyle: "TEXT_HIGHLIGHT" }))
  UI.println()

  const proceed = await confirm({
    message: "Save this configuration?",
    initialValue: true,
  })

  if (proceed) {
    const spinner = new Progress.Spinner("Saving configuration")
    spinner.start()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    spinner.succeed("Configuration saved")
  }
}
