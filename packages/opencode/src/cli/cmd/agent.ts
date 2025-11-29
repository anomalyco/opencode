import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Agent } from "../../agent/agent"
import path from "path"
import matter from "gray-matter"
import { Instance } from "../../project/instance"
import { EOL } from "os"

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Create agent")
        const project = Instance.project

        let scope: "global" | "project" = "global"
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: "project" as const,
                hint: Instance.worktree,
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

        const spinner = prompts.spinner()

        spinner.start("Generating agent configuration...")
        const generated = await Agent.generate({ description: query }).catch((error) => {
          spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
          throw new UI.CancelledError()
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
          scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".opencode"),
          `agent`,
          `${generated.identifier}.md`,
        )

        await Bun.write(filePath, content)

        prompts.log.success(`Agent created: ${filePath}`)
        prompts.outro("Done")
      },
    })
  },
})

const AgentListCommand = cmd({
  command: "list",
  describe: "list all available agents",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const agents = await Agent.list()
        const sortedAgents = agents.sort((a, b) => {
          if (a.builtIn !== b.builtIn) {
            return a.builtIn ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        for (const agent of sortedAgents) {
          process.stdout.write(`${agent.name} (${agent.mode})${EOL}`)
        }
      },
    })
  },
})

export const AgentCommand = cmd({
  command: "agent",
  describe: "manage agents",
  builder: (yargs) => yargs.command(AgentCreateCommand).command(AgentListCommand).demandCommand(),
  async handler() {},
})
