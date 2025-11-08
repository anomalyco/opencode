import type { Argv } from "yargs"
import { UI } from "../ui"
import { RichUI } from "../rich-ui"
import { cmd } from "./cmd"
import { OpenRouter } from "../../provider/openrouter"
import { select, text, confirm } from "@clack/prompts"
import { Auth } from "../../auth"

export const OpenRouterCommand = cmd({
  command: "openrouter",
  describe: "explore and configure OpenRouter (400+ AI models)",
  builder: (yargs: Argv) => {
    return yargs
      .command({
        command: "models",
        describe: "browse available models",
        handler: async () => {
          await browseModels()
        },
      })
      .command({
        command: "flagship",
        describe: "show flagship models (GPT-5, Claude 4.5, Grok 4, etc.)",
        handler: async () => {
          await showFlagshipModels()
        },
      })
      .command({
        command: "free",
        describe: "show free models",
        handler: async () => {
          await showFreeModels()
        },
      })
      .command({
        command: "login",
        describe: "configure OpenRouter API key",
        handler: async () => {
          await configureApiKey()
        },
      })
      .command({
        command: "info <model>",
        describe: "show detailed model information",
        builder: (yargs: Argv) =>
          yargs.positional("model", {
            describe: "model name or ID",
            type: "string",
          }),
        handler: async (args) => {
          await showModelInfo(args.model as string)
        },
      })
      .demandCommand(1, "Please specify a subcommand")
  },
  handler: async () => {
    UI.println()
    UI.println(
      RichUI.banner(
        `${UI.Style.TEXT_HIGHLIGHT_BOLD}OpenRouter${UI.Style.TEXT_NORMAL}\nOne API for 400+ AI Models\n\n${UI.Style.TEXT_DIM}Access GPT-5, Claude 4.5, Grok 4, Gemini 2.5 Pro,\nDeepSeek R1, and hundreds more through a single API.`,
        "TEXT_HIGHLIGHT",
      ),
    )
    UI.println()

    const flagship = OpenRouter.listFlagshipModels()
    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "🚀 Latest Flagship Models (2025)" + UI.Style.TEXT_NORMAL)
    UI.println()

    for (const model of flagship) {
      const cost =
        model.cost.input === 0
          ? UI.Style.TEXT_SUCCESS + "FREE" + UI.Style.TEXT_NORMAL
          : `$${model.cost.input}/$${model.cost.output} per 1M tokens`

      UI.println(
        `  ${UI.Style.TEXT_HIGHLIGHT}${model.name.padEnd(25)}${UI.Style.TEXT_NORMAL} ${UI.Style.TEXT_DIM}${model.id.padEnd(45)}${UI.Style.TEXT_NORMAL} ${cost}`,
      )
      UI.println(
        `    ${UI.Style.TEXT_DIM}Context: ${RichUI.formatBytes(model.limit.context * 4)} | Released: ${model.release_date}${UI.Style.TEXT_NORMAL}`,
      )
      UI.println()
    }

    UI.println()
    UI.println(UI.Style.TEXT_DIM + "Available commands:" + UI.Style.TEXT_NORMAL)
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode openrouter models" + UI.Style.TEXT_NORMAL + "    - Browse all models")
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode openrouter flagship" + UI.Style.TEXT_NORMAL + "  - Show flagship models")
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode openrouter free" + UI.Style.TEXT_NORMAL + "      - Show free models")
    UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode openrouter login" + UI.Style.TEXT_NORMAL + "     - Configure API key")
    UI.println()

    UI.println(UI.Style.TEXT_INFO + RichUI.Icons.info + " Get your API key at: " + UI.Style.TEXT_HIGHLIGHT + "https://openrouter.ai/keys" + UI.Style.TEXT_NORMAL)
    UI.println()
  },
})

async function browseModels(): Promise<void> {
  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "OpenRouter Model Catalog" + UI.Style.TEXT_NORMAL)
  UI.println()

  const category = await select({
    message: "Browse by category:",
    options: [
      { value: "all", label: "All Models", hint: `${Object.keys(OpenRouter.MODELS).length} models` },
      { value: "flagship", label: "Flagship Models", hint: "Latest and greatest (2025)" },
      { value: "free", label: "Free Models", hint: "No cost" },
      { value: "reasoning", label: "Reasoning Models", hint: "Advanced thinking" },
      { value: "coding", label: "Best for Coding", hint: "Top coding performance" },
    ],
  })

  if (typeof category === "symbol") {
    return
  }

  let models = OpenRouter.listModels()

  switch (category) {
    case "flagship":
      models = OpenRouter.listFlagshipModels()
      break
    case "free":
      models = OpenRouter.listFreeModels()
      break
    case "reasoning":
      models = models.filter((m) => m.reasoning)
      break
    case "coding":
      models = [
        OpenRouter.MODELS["claude-4.5-sonnet"],
        OpenRouter.MODELS["gpt-5"],
        OpenRouter.MODELS["claude-4.1-opus"],
        OpenRouter.MODELS["deepseek-chat-v3"],
      ]
      break
  }

  UI.println()
  UI.println(UI.Style.TEXT_SUCCESS + `Found ${models.length} models` + UI.Style.TEXT_NORMAL)
  UI.println()

  const headers = ["Model", "ID", "Context", "Cost"]
  const rows = models.map((m) => [
    m.name,
    UI.Style.TEXT_DIM + m.id + UI.Style.TEXT_NORMAL,
    RichUI.formatBytes(m.limit.context * 4), // ~4 bytes per token
    m.cost.input === 0
      ? UI.Style.TEXT_SUCCESS + "FREE" + UI.Style.TEXT_NORMAL
      : `$${m.cost.input}/$${m.cost.output}`,
  ])

  UI.println(RichUI.table(headers, rows))
  UI.println()
}

async function showFlagshipModels(): Promise<void> {
  const models = OpenRouter.listFlagshipModels()

  UI.println()
  UI.println(
    RichUI.banner(
      "Flagship Models 2025\nThe Latest and Greatest AI Models",
      "TEXT_HIGHLIGHT",
    ),
  )
  UI.println()

  for (const model of models) {
    UI.println(
      RichUI.box(
        RichUI.keyValue({
          Name: model.name,
          ID: model.id,
          Released: model.release_date,
          "Context Window": `${model.limit.context.toLocaleString()} tokens (${RichUI.formatBytes(model.limit.context * 4)})`,
          "Output Limit": `${model.limit.output.toLocaleString()} tokens`,
          "Input Cost": model.cost.input === 0 ? "FREE" : `$${model.cost.input} per 1M tokens`,
          "Output Cost": model.cost.output === 0 ? "FREE" : `$${model.cost.output} per 1M tokens`,
          Reasoning: model.reasoning ? "Yes" : "No",
          "Tool Calling": model.tool_call ? "Yes" : "No",
          Modalities: model.modalities
            ? `Input: ${model.modalities.input.join(", ")} | Output: ${model.modalities.output.join(", ")}`
            : "Text only",
        }),
        { title: model.name, style: "TEXT_HIGHLIGHT" },
      ),
    )
    UI.println()
  }

  UI.println(UI.Style.TEXT_DIM + "Use these models with: " + UI.Style.TEXT_HIGHLIGHT + "opencode run --model openrouter/<model-id>" + UI.Style.TEXT_NORMAL)
  UI.println()
}

async function showFreeModels(): Promise<void> {
  const models = OpenRouter.listFreeModels()

  UI.println()
  UI.println(
    RichUI.banner(
      `${UI.Style.TEXT_SUCCESS_BOLD}Free Models${UI.Style.TEXT_NORMAL}\n${models.length} Models at Zero Cost`,
      "TEXT_SUCCESS",
    ),
  )
  UI.println()

  UI.println(UI.Style.TEXT_INFO + RichUI.Icons.info + " Free models require opting into data training" + UI.Style.TEXT_NORMAL)
  UI.println()

  const headers = ["Model", "ID", "Context", "Features"]
  const rows = models.map((m) => {
    const features: string[] = []
    if (m.reasoning) features.push("Reasoning")
    if (m.tool_call) features.push("Tools")
    if (m.modalities?.input.includes("image")) features.push("Vision")

    return [
      m.name,
      UI.Style.TEXT_DIM + m.id + UI.Style.TEXT_NORMAL,
      RichUI.formatBytes(m.limit.context * 4),
      features.join(", ") || "-",
    ]
  })

  UI.println(RichUI.table(headers, rows))
  UI.println()

  // Highlight recommended free model
  const recommended = OpenRouter.getRecommendedFree()
  UI.println(
    `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Recommended: ${UI.Style.TEXT_HIGHLIGHT}${recommended.name}${UI.Style.TEXT_NORMAL} - ${UI.Style.TEXT_DIM}Best free model with reasoning (671B params)${UI.Style.TEXT_NORMAL}`,
  )
  UI.println()
}

async function configureApiKey(): Promise<void> {
  UI.println()
  UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Configure OpenRouter API Key" + UI.Style.TEXT_NORMAL)
  UI.println()

  UI.println("Get your API key from: " + UI.Style.TEXT_HIGHLIGHT + "https://openrouter.ai/keys" + UI.Style.TEXT_NORMAL)
  UI.println()

  const apiKey = await text({
    message: "Enter your OpenRouter API key:",
    placeholder: "sk-or-v1-...",
    validate: (value) => {
      if (!value || value.length < 20) {
        return "Please enter a valid OpenRouter API key"
      }
    },
  })

  if (typeof apiKey !== "string") {
    UI.println("Cancelled")
    return
  }

  // Save the API key
  await Auth.save("openrouter", { apiKey })

  UI.println()
  UI.println(
    `${UI.Style.TEXT_SUCCESS}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} API key saved successfully!`,
  )
  UI.println()

  UI.println(UI.Style.TEXT_DIM + "You can now use OpenRouter models:" + UI.Style.TEXT_NORMAL)
  UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode run --model openrouter/gpt-5 'your prompt'" + UI.Style.TEXT_NORMAL)
  UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode run --model openrouter/claude-4.5-sonnet 'your prompt'" + UI.Style.TEXT_NORMAL)
  UI.println()
}

async function showModelInfo(modelName: string): Promise<void> {
  const model =
    OpenRouter.MODELS[modelName] ||
    Object.values(OpenRouter.MODELS).find(
      (m) => m.id === modelName || m.id.endsWith(modelName) || m.name.toLowerCase() === modelName.toLowerCase(),
    )

  if (!model) {
    UI.error(`Model '${modelName}' not found`)
    UI.println()
    UI.println("Run " + UI.Style.TEXT_HIGHLIGHT + "opencode openrouter models" + UI.Style.TEXT_NORMAL + " to see all available models")
    return
  }

  UI.println()
  UI.println(
    RichUI.box(
      RichUI.keyValue({
        Name: model.name,
        ID: model.id,
        Released: model.release_date,
        Provider: model.id.split("/")[0],
        "Context Window": `${model.limit.context.toLocaleString()} tokens (${RichUI.formatBytes(model.limit.context * 4)})`,
        "Max Output": `${model.limit.output.toLocaleString()} tokens`,
        "Input Cost": model.cost.input === 0 ? UI.Style.TEXT_SUCCESS + "FREE" + UI.Style.TEXT_NORMAL : `$${model.cost.input} per 1M tokens`,
        "Output Cost": model.cost.output === 0 ? UI.Style.TEXT_SUCCESS + "FREE" + UI.Style.TEXT_NORMAL : `$${model.cost.output} per 1M tokens`,
        "Cache Read": model.cost.cache_read ? `$${model.cost.cache_read} per 1M tokens` : "N/A",
        "Cache Write": model.cost.cache_write ? `$${model.cost.cache_write} per 1M tokens` : "N/A",
        "": "",
        Reasoning: model.reasoning ? UI.Style.TEXT_SUCCESS + "Yes" : "No",
        "Tool Calling": model.tool_call ? UI.Style.TEXT_SUCCESS + "Yes" : "No",
        Attachments: model.attachment ? UI.Style.TEXT_SUCCESS + "Yes" : "No",
        Temperature: model.temperature ? UI.Style.TEXT_SUCCESS + "Yes" : "No",
        " ": "",
        "Input Modalities": model.modalities?.input.join(", ") || "text",
        "Output Modalities": model.modalities?.output.join(", ") || "text",
      }),
      { title: `Model: ${model.name}`, style: "TEXT_INFO", padding: 2 },
    ),
  )
  UI.println()

  UI.println(UI.Style.TEXT_DIM + "Use this model with:" + UI.Style.TEXT_NORMAL)
  UI.println(`  ${UI.Style.TEXT_HIGHLIGHT}opencode run --model openrouter/${model.id.split("/")[1]} "your prompt"${UI.Style.TEXT_NORMAL}`)
  UI.println()
}
