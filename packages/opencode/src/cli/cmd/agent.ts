import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import path from "path"
import matter from "gray-matter"
import { App } from "../../app/app"

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs) => {
    return yargs.option("model", {
      type: "string",
      alias: ["m"],
      describe: "model to use in the format of provider/model",
    })
  },
  async handler(args) {
    await App.provide({ cwd: process.cwd() }, async (app) => {
      UI.empty()
      prompts.intro("Create agent")

      let scope: "global" | "project" = "global"
      if (app.git) {
        const scopeResult = await prompts.select({
          message: "Location",
          options: [
            {
              label: "Current project",
              value: "project" as const,
              hint: app.path.root,
            },
            {
              label: "Global",
              value: "global" as const,
              hint: Global.Path.config,
            },
          ],
        })
        if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
        scope = scopeResult
      }

      const query = await prompts.text({
        message: "Description",
        placeholder: "What should this agent do?",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(query)) throw new UI.CancelledError()

      let modelConfig: { providerID: string; modelID: string } | undefined
      if (args.model) {
        try {
          const parsed = Provider.parseModel(args.model)
          const provider = await Provider.getProvider(parsed.providerID)
          if (!provider) {
            throw new Error(`Provider '${parsed.providerID}' not found`)
          }
          await Provider.getModel(parsed.providerID, parsed.modelID)
          modelConfig = parsed
        } catch (error) {
          prompts.log.error(`Invalid model: ${args.model}`)
          prompts.log.error(error instanceof Error ? error.message : String(error))
          throw new UI.CancelledError()
        }
      }

      const spinner = prompts.spinner()

      const spinnerMessage = modelConfig
        ? `Generating agent configuration using ${modelConfig.providerID}/${modelConfig.modelID}...`
        : "Generating agent configuration..."
      spinner.start(spinnerMessage)
      const generated = await Agent.generate({
        description: query,
        model: modelConfig,
      })
      spinner.stop(`Agent ${generated.identifier} generated`)

      const availableTools = [
        "bash",
        "read",
        "write",
        "edit",
        "list",
        "glob",
        "grep",
        "webfetch",
        "task",
        "todowrite",
        "todoread",
      ]

      const selectedTools = await prompts.multiselect({
        message: "Select tools to enable",
        options: availableTools.map((tool) => ({
          label: tool,
          value: tool,
        })),
        initialValues: availableTools,
      })
      if (prompts.isCancel(selectedTools)) throw new UI.CancelledError()

      const modeResult = await prompts.select({
        message: "Agent mode",
        options: [
          {
            label: "All",
            value: "all" as const,
            hint: "Can function in both primary and subagent roles",
          },
          {
            label: "Primary",
            value: "primary" as const,
            hint: "Acts as a primary/main agent",
          },
          {
            label: "Subagent",
            value: "subagent" as const,
            hint: "Can be used as a subagent by other agents",
          },
        ],
        initialValue: "all",
      })
      if (prompts.isCancel(modeResult)) throw new UI.CancelledError()

      const tools: Record<string, boolean> = {}
      for (const tool of availableTools) {
        if (!selectedTools.includes(tool)) {
          tools[tool] = false
        }
      }

      const frontmatter: any = {
        description: generated.whenToUse,
        mode: modeResult,
      }
      if (Object.keys(tools).length > 0) {
        frontmatter.tools = tools
      }

      const content = matter.stringify(generated.systemPrompt, frontmatter)
      const filePath = path.join(
        scope === "global" ? Global.Path.config : path.join(app.path.root, ".opencode"),
        `agent`,
        `${generated.identifier}.md`,
      )

      await Bun.write(filePath, content)

      prompts.log.success(`Agent created: ${filePath}`)
      prompts.outro("Done")
    })
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).demandCommand(),
  async handler() {},
})
