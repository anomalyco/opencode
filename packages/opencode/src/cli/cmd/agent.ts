import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Global } from "../../global"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Skill } from "../../skill"
import { Config } from "../../config/config"
import path from "path"
import fs from "fs/promises"
import matter from "gray-matter"
import { Instance } from "../../project/instance"
import { EOL } from "os"
import type { Argv } from "yargs"

type AgentMode = "all" | "primary" | "subagent"

const AVAILABLE_TOOLS = [
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

const MODE_OPTIONS = [
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
]

async function selectModel(): Promise<{ providerID: string; modelID: string }> {
  const providers = await Provider.list()
  const providerOptions = Object.entries(providers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([providerID, provider]) => ({
      label: providerID,
      value: providerID,
      hint: `${Object.keys(provider.models).length} models`,
    }))

  const providerResult = await prompts.select({
    message: "Select provider",
    options: providerOptions,
  })
  if (prompts.isCancel(providerResult)) throw new UI.CancelledError()

  const selectedProvider = providers[providerResult]
  const modelOptions = Object.entries(selectedProvider.models)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([modelID]) => ({
      label: modelID,
      value: modelID,
    }))

  const modelResult = await prompts.select({
    message: "Select model",
    options: modelOptions,
  })
  if (prompts.isCancel(modelResult)) throw new UI.CancelledError()

  return { providerID: providerResult, modelID: modelResult }
}

function buildToolsConfig(selectedTools: string[]): Record<string, boolean> {
  const tools: Record<string, boolean> = {}
  for (const tool of AVAILABLE_TOOLS) {
    if (!selectedTools.includes(tool)) {
      tools[tool] = false
    }
  }
  return tools
}

function buildSkillOptions(skills: Awaited<ReturnType<typeof Skill.all>>) {
  return skills.map((skill) => {
    const isProjectSkill = skill.location.includes("/.opencode/")
    return {
      label: `${skill.name}${isProjectSkill ? " [proj]" : ""}`,
      value: skill.name,
      hint: skill.description,
    }
  })
}

function sortAgents(agents: Awaited<ReturnType<typeof Agent.list>>) {
  return agents.sort((a, b) => {
    if (a.native !== b.native) return a.native ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function findAgentFile(agentName: string): Promise<{ path: string; isProject: boolean } | null> {
  const directories = await Config.directories()
  const worktree = Instance.worktree

  for (const dir of directories) {
    const candidatePath = path.join(dir, "agent", `${agentName}.md`)
    const file = Bun.file(candidatePath)
    if (await file.exists()) {
      const isProject = candidatePath.startsWith(path.join(worktree, ".opencode"))
      return { path: candidatePath, isProject }
    }
  }
  return null
}

const AgentCreateCommand = cmd({
  command: "create",
  describe: "create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .option("path", {
        type: "string",
        describe: "directory path to generate the agent file",
      })
      .option("description", {
        type: "string",
        describe: "what the agent should do",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("tools", {
        type: "string",
        describe: `comma-separated list of tools to enable (default: all). Available: "${AVAILABLE_TOOLS.join(", ")}"`,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in format of provider/model",
      })
      .option("skills", {
        type: "string",
        describe:
          "comma-separated list of skills to allow (default: all available skills). Use 'none' to disable skill access entirely.",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const cliPath = args.path
        const cliDescription = args.description
        const cliMode = args.mode as AgentMode | undefined
        const cliTools = args.tools
        const cliSkills = args.skills

        const isFullyNonInteractive =
          cliPath && cliDescription && cliMode && cliTools !== undefined && cliSkills !== undefined

        if (!isFullyNonInteractive) {
          UI.empty()
          prompts.intro("Create agent")
        }

        const project = Instance.project

        // Determine scope/path
        let targetPath: string
        if (cliPath) {
          targetPath = path.join(cliPath, "agent")
        } else {
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
          targetPath = path.join(
            scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".opencode"),
            "agent",
          )
        }

        // Get description
        let description: string
        if (cliDescription) {
          description = cliDescription
        } else {
          const query = await prompts.text({
            message: "Description",
            placeholder: "What should this agent do?",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(query)) throw new UI.CancelledError()
          description = query
        }

        const spinner = prompts.spinner()
        spinner.start("Generating agent configuration...")
        const generated = await Agent.generate({ description }).catch((error) => {
          spinner.stop(`LLM failed to generate agent: ${error.message}`, 1)
          if (isFullyNonInteractive) process.exit(1)
          throw new UI.CancelledError()
        })
        spinner.stop(`Agent ${generated.identifier} generated`)

        // Select tools
        let selectedTools: string[]
        if (cliTools !== undefined) {
          selectedTools = cliTools ? cliTools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
        } else {
          const result = await prompts.multiselect({
            message: "Select tools to enable",
            options: AVAILABLE_TOOLS.map((tool) => ({
              label: tool,
              value: tool,
            })),
            initialValues: AVAILABLE_TOOLS,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          selectedTools = result
        }

        // Get mode
        let mode: AgentMode
        if (cliMode) {
          mode = cliMode
        } else {
          const modeResult = await prompts.select({
            message: "Agent mode",
            options: MODE_OPTIONS,
            initialValue: "all" as const,
          })
          if (prompts.isCancel(modeResult)) throw new UI.CancelledError()
          mode = modeResult
        }

        // Select skills
        let skillPermissions: Record<string, "allow" | "deny"> | null = null
        const availableSkills = await Skill.all()
        if (availableSkills.length > 0) {
          let selectedSkills: string[] | "none" | "all"
          if (cliSkills !== undefined) {
            if (cliSkills === "none") {
              selectedSkills = "none"
            } else if (cliSkills === "all" || cliSkills === "") {
              selectedSkills = "all"
            } else {
              selectedSkills = cliSkills.split(",").map((s) => s.trim())
            }
          } else {
            const skillOptions = buildSkillOptions(availableSkills)
            const result = await prompts.multiselect({
              message: "Select skills to allow (empty selection = all skills, 'none' option to disable)",
              options: [...skillOptions, { label: "Disable all skills", value: "__disable__" }],
              initialValues: [],
            })
            if (prompts.isCancel(result)) throw new UI.CancelledError()
            if (result.includes("__disable__")) {
              selectedSkills = "none"
            } else if (result.length === 0) {
              selectedSkills = "all"
            } else {
              selectedSkills = result
            }
          }

          if (selectedSkills === "none") {
            skillPermissions = { "*": "deny" }
          } else if (selectedSkills !== "all") {
            skillPermissions = {
              "*": "deny",
              ...Object.fromEntries(selectedSkills.map((s) => [s, "allow" as const])),
            }
          }
        }

        let model: string | undefined
        if (args.model) {
          model = args.model
        } else if (!isFullyNonInteractive) {
          const modelAction = await prompts.select({
            message: "Model configuration",
            options: [
              { label: "Do not define a model", value: "skip" as const },
              { label: "Define a model", value: "define" as const },
            ],
          })
          if (prompts.isCancel(modelAction)) throw new UI.CancelledError()

          if (modelAction === "define") {
            const selected = await selectModel()
            model = `${selected.providerID}/${selected.modelID}`
          }
        }

        // Build tools config
        const tools = buildToolsConfig(selectedTools)

        // Build frontmatter
        const frontmatter: {
          description: string
          mode: AgentMode
          model?: string
          tools?: Record<string, boolean>
          permission?: { skill?: Record<string, "allow" | "deny"> }
        } = {
          description: generated.whenToUse,
          mode,
        }
        if (model) {
          frontmatter.model = model
        }
        if (Object.keys(tools).length > 0) {
          frontmatter.tools = tools
        }
        if (skillPermissions) {
          frontmatter.permission = {
            skill: skillPermissions,
          }
        }

        // Write file
        const content = matter.stringify(generated.systemPrompt, frontmatter)
        const filePath = path.join(targetPath, `${generated.identifier}.md`)

        await fs.mkdir(targetPath, { recursive: true })

        const file = Bun.file(filePath)
        if (await file.exists()) {
          if (isFullyNonInteractive) {
            console.error(`Error: Agent file already exists: ${filePath}`)
            process.exit(1)
          }
          prompts.log.error(`Agent file already exists: ${filePath}`)
          throw new UI.CancelledError()
        }

        await Bun.write(filePath, content)

        if (isFullyNonInteractive) {
          console.log(filePath)
        } else {
          prompts.log.success(`Agent created: ${filePath}`)
          prompts.outro("Done")
        }
      },
    })
  },
})

const AgentEditCommand = cmd({
  command: "edit",
  describe: "edit an existing agent",
  builder: (yargs: Argv) =>
    yargs
      .option("tools", {
        type: "string",
        describe: "comma-separated list of tools to enable (default: keep current)",
      })
      .option("skills", {
        type: "string",
        describe:
          "comma-separated list of skills to allow (default: keep current). Use 'none' to disable, 'all' to allow all.",
      })
      .option("mode", {
        type: "string",
        describe: "agent mode",
        choices: ["all", "primary", "subagent"] as const,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })

      .option("color", {
        type: "string",
        describe: "hex color code for the agent (e.g., #FF5733)",
      })
      .positional("agent", {
        type: "string",
        describe: "agent name/identifier to edit",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        let agentName = args.agent as string

        const allAgents = await Agent.list()
        const sortedAgents = sortAgents(allAgents)

        const agentOptions: { label: string; value: string }[] = []
        for (const agent of sortedAgents) {
          if (agent.native) {
            agentOptions.push({ label: `${agent.name} (${agent.mode})`, value: agent.name })
          } else {
            const fileInfo = await findAgentFile(agent.name)
            const isProject = fileInfo?.isProject ?? false
            agentOptions.push({
              label: `${agent.name}${isProject ? " [proj]" : ""} (${agent.mode})`,
              value: agent.name,
            })
          }
        }

        if (!agentName) {
          UI.empty()
          prompts.intro("Edit agent")
          const result = await prompts.select({
            message: "Select agent to edit",
            options: agentOptions,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          agentName = result
        } else {
          const exists = sortedAgents.some((a) => a.name === agentName)
          if (!exists) {
            console.error(`Error: Agent "${agentName}" not found`)
            process.exit(1)
          }
        }

        UI.empty()
        prompts.intro(`Edit agent: ${agentName}`)

        const fileInfo = await findAgentFile(agentName)
        if (!fileInfo) {
          console.error(`Error: Agent file for "${agentName}" not found`)
          process.exit(1)
        }

        const agentFilePath = fileInfo.path
        const fileContent = await Bun.file(agentFilePath).text()
        const parsed = matter(fileContent)
        const agentData = {
          frontmatter: parsed.data,
          content: parsed.content,
        }

        // Get current frontmatter values
        const currentFrontmatter = agentData.frontmatter

        // Interactive prompts for each field if not provided via CLI
        const isNonInteractive =
          args.tools !== undefined ||
          args.skills !== undefined ||
          args.mode !== undefined ||
          args.model !== undefined ||
          args.color !== undefined

        // Edit mode
        let mode: AgentMode = currentFrontmatter.mode || "all"
        if (args.mode) {
          mode = args.mode as AgentMode
        } else if (!isNonInteractive) {
          const result = await prompts.select({
            message: "Agent mode",
            options: MODE_OPTIONS,
            initialValue: mode,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          mode = result
        }

        // Edit tools
        let tools: Record<string, boolean> = currentFrontmatter.tools || {}
        if (args.tools !== undefined) {
          const selectedTools = args.tools ? args.tools.split(",").map((t) => t.trim()) : AVAILABLE_TOOLS
          tools = buildToolsConfig(selectedTools)
        } else if (!isNonInteractive) {
          const currentDisabledTools = Object.entries(tools)
            .filter(([, v]) => v === false)
            .map(([k]) => k)
          const initialValues = AVAILABLE_TOOLS.filter((t) => !currentDisabledTools.includes(t))

          const result = await prompts.multiselect({
            message: "Select tools to enable",
            options: AVAILABLE_TOOLS.map((tool) => ({
              label: tool,
              value: tool,
            })),
            initialValues,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          tools = buildToolsConfig(result)
        }

        // Edit skills
        let skillPermissions: Record<string, "allow" | "deny"> | null = null
        const availableSkills = await Skill.all()
        if (availableSkills.length > 0 && !isNonInteractive) {
          const currentSkillPerms = currentFrontmatter.permission?.skill
          let currentAllowedSkills: string[] = []
          if (currentSkillPerms) {
            if (currentSkillPerms["*"] === "deny") {
              currentAllowedSkills = Object.entries(currentSkillPerms)
                .filter(([k, v]) => v === "allow" && k !== "*")
                .map(([k]) => k)
            } else if (currentSkillPerms["*"] === "allow") {
              currentAllowedSkills = [] // empty means all allowed
            }
          }

          const skillOptions = buildSkillOptions(availableSkills)
          const result = await prompts.multiselect({
            message: "Select skills to allow (empty = all skills, select 'none' to disable)",
            options: [...skillOptions, { label: "Disable all skills", value: "__disable__" }],
            initialValues: currentAllowedSkills,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()

          if (result.includes("__disable__")) {
            skillPermissions = { "*": "deny" }
          } else if (result.length === 0) {
            skillPermissions = null // remove skill permissions = all skills allowed
          } else {
            skillPermissions = {
              "*": "deny",
              ...Object.fromEntries(result.map((s) => [s, "allow" as const])),
            }
          }
        }

        // Edit color
        let color = args.color || currentFrontmatter.color
        if (!args.color && !isNonInteractive) {
          const result = await prompts.text({
            message: "Color (hex code, e.g., #FF5733)",
            placeholder: currentFrontmatter.color || "#FF5733",
            defaultValue: currentFrontmatter.color,
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          if (result && result.trim()) color = result.trim()
        }

        // Build updated frontmatter
        const updatedFrontmatter: Record<string, any> = {
          ...currentFrontmatter,
          mode,
        }

        if (Object.keys(tools).length > 0) {
          updatedFrontmatter.tools = tools
        } else {
          delete updatedFrontmatter.tools
        }

        if (skillPermissions) {
          updatedFrontmatter.permission = {
            ...(currentFrontmatter.permission || {}),
            skill: skillPermissions,
          }
        } else if (currentFrontmatter.permission?.skill) {
          updatedFrontmatter.permission = {
            ...currentFrontmatter.permission,
          }
          delete updatedFrontmatter.permission.skill
        }

        if (color) {
          updatedFrontmatter.color = color
        } else {
          delete updatedFrontmatter.color
        }

        // Edit model
        let model: string | undefined = currentFrontmatter.model
        if (args.model) {
          model = args.model
        } else if (!isNonInteractive) {
          const currentModelHint = currentFrontmatter.model
            ? `current: ${currentFrontmatter.model}`
            : "currently undefined"
          const modelAction = await prompts.select({
            message: `Model configuration (${currentModelHint})`,
            options: [
              { label: "Do not change", value: "skip" as const },
              { label: "Remove model", value: "undefine" as const },
              { label: "Define a model", value: "define" as const },
            ],
          })
          if (prompts.isCancel(modelAction)) throw new UI.CancelledError()

          if (modelAction === "define") {
            const selected = await selectModel()
            model = `${selected.providerID}/${selected.modelID}`
          } else if (modelAction === "undefine") {
            model = undefined
          }
        }

        if (model) {
          updatedFrontmatter.model = model
        } else {
          delete updatedFrontmatter.model
        }

        // Write updated file
        const content = matter.stringify(agentData.content, updatedFrontmatter)
        await Bun.write(agentFilePath, content)

        prompts.log.success(`Agent updated: ${agentFilePath}`)
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
        const sortedAgents = sortAgents(agents)

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
  builder: (yargs) =>
    yargs.command(AgentCreateCommand).command(AgentEditCommand).command(AgentListCommand).demandCommand(),
  async handler() {},
})
