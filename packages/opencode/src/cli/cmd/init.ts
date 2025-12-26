import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { Provider } from "../../provider/provider"
import { Identifier } from "../../id/id"
import { SessionStatus } from "../../session/status"
import path from "path"

type PermissionValue = "allow" | "ask" | "deny"

interface PermissionConfig {
  permission: {
    bash: PermissionValue
    edit: PermissionValue
    webfetch: PermissionValue
    skill: PermissionValue
  }
}

async function promptPermissions(): Promise<PermissionConfig> {
  const bashPermission = await prompts.select({
    message: "Bash command execution",
    options: [
      {
        label: "Allow",
        value: "allow",
        hint: "Execute bash commands without asking",
      },
      {
        label: "Ask",
        value: "ask",
        hint: "Prompt before executing bash commands",
      },
      {
        label: "Deny",
        value: "deny",
        hint: "Block all bash command execution",
      },
    ],
    initialValue: "allow",
  })
  if (prompts.isCancel(bashPermission)) throw new UI.CancelledError()

  const editPermission = await prompts.select({
    message: "File editing",
    options: [
      {
        label: "Allow",
        value: "allow",
        hint: "Edit files without asking",
      },
      {
        label: "Ask",
        value: "ask",
        hint: "Prompt before editing files",
      },
      {
        label: "Deny",
        value: "deny",
        hint: "Block all file editing",
      },
    ],
    initialValue: "allow",
  })
  if (prompts.isCancel(editPermission)) throw new UI.CancelledError()

  const webfetchPermission = await prompts.select({
    message: "Web fetching",
    options: [
      {
        label: "Allow",
        value: "allow",
        hint: "Fetch web content without asking",
      },
      {
        label: "Ask",
        value: "ask",
        hint: "Prompt before fetching web content",
      },
      {
        label: "Deny",
        value: "deny",
        hint: "Block all web fetching",
      },
    ],
    initialValue: "allow",
  })
  if (prompts.isCancel(webfetchPermission)) throw new UI.CancelledError()

  const skillPermission = await prompts.select({
    message: "Skill tool usage",
    options: [
      {
        label: "Allow",
        value: "allow",
        hint: "Use skill tools without asking",
      },
      {
        label: "Ask",
        value: "ask",
        hint: "Prompt before using skill tools",
      },
      {
        label: "Deny",
        value: "deny",
        hint: "Block all skill tool usage",
      },
    ],
    initialValue: "allow",
  })
  if (prompts.isCancel(skillPermission)) throw new UI.CancelledError()

  return {
    permission: {
      bash: bashPermission === "allow" || bashPermission === "deny" ? bashPermission : "ask",
      edit: editPermission as PermissionValue,
      webfetch: webfetchPermission as PermissionValue,
      skill: skillPermission === "allow" || skillPermission === "deny" ? skillPermission : "ask",
    },
  }
}

async function createConfigFile(
  permissionConfig: PermissionConfig | Record<string, never>,
  skipConfig: boolean,
): Promise<void> {
  const configPath = path.join(Instance.worktree, "opencode.jsonc")
  const configExists = await Bun.file(configPath).exists()

  if (configExists) {
    if (skipConfig) {
      console.log("opencode.jsonc already exists, skipping")
      return
    }

    const overwrite = await prompts.confirm({
      message: "opencode.jsonc already exists. Overwrite?",
      initialValue: false,
    })
    if (prompts.isCancel(overwrite)) throw new UI.CancelledError()

    if (!overwrite) {
      prompts.log.info("Skipping config file creation")
      return
    }
  }

  if (Object.keys(permissionConfig).length === 0) return

  const configContent = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      ...permissionConfig,
    },
    null,
    2,
  )
  await Bun.write(configPath, configContent)

  if (skipConfig) {
    console.log(`Created ${configPath} with default settings`)
    return
  }

  prompts.log.success(`Created ${configPath}`)
}

async function generateAgentsFile(skipConfig: boolean): Promise<void> {
  const agentsPath = path.join(Instance.worktree, "AGENTS.md")
  const agentsExists = await Bun.file(agentsPath).exists()

  if (skipConfig) {
    if (agentsExists) {
      console.log("AGENTS.md already exists, skipping")
    } else {
      console.log("Skipping AGENTS.md generation (--skip flag)")
    }
    return
  }

  if (agentsExists) {
    UI.empty()
    const shouldRegenerate = await prompts.confirm({
      message: "AGENTS.md already exists. Regenerate by analyzing your codebase with AI?",
      initialValue: false,
    })
    if (prompts.isCancel(shouldRegenerate)) throw new UI.CancelledError()

    if (!shouldRegenerate) {
      prompts.log.info("Keeping existing AGENTS.md")
      return
    }
  } else {
    UI.empty()
    const shouldGenerate = await prompts.confirm({
      message: "Generate AGENTS.md by analyzing your codebase with AI?",
      initialValue: true,
    })
    if (prompts.isCancel(shouldGenerate)) throw new UI.CancelledError()

    if (!shouldGenerate) {
      prompts.log.info("Skipping AGENTS.md generation. Run '/init' in an OpenCode session later to generate it")
      return
    }
  }

  const spinner = prompts.spinner()
  spinner.start("Analyzing codebase and generating AGENTS.md...")

  try {
    const model = await Provider.defaultModel()
    const session = await Session.create({
      title: "Initialize AGENTS.md",
    })

    await Session.initialize({
      sessionID: session.id,
      modelID: model.modelID,
      providerID: model.providerID,
      messageID: Identifier.ascending("message"),
    })

    // Wait for the session to complete
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const status = SessionStatus.get(session.id)
        if (status?.type !== "busy") {
          clearInterval(checkInterval)
          resolve()
        }
      }, 500)

      // Timeout after 2 minutes
      setTimeout(() => {
        clearInterval(checkInterval)
        resolve()
      }, 120000)
    })

    // Clean up the temporary session
    await Session.remove(session.id)

    spinner.stop(agentsExists ? "Regenerated AGENTS.md" : "Generated AGENTS.md")
  } catch (error) {
    spinner.stop("Failed to generate AGENTS.md")
    const errorMessage = error instanceof Error ? error.message : String(error)
    prompts.log.error(errorMessage)
    prompts.log.info("You can run '/init' in an OpenCode session later to generate it")
  }
}

async function updateGitignore(skipConfig: boolean): Promise<void> {
  const gitignorePath = path.join(Instance.worktree, ".gitignore")
  const gitignoreExists = await Bun.file(gitignorePath).exists()

  if (!gitignoreExists) {
    await Bun.write(gitignorePath, "# OpenCode config\nopencode.jsonc\n")
    if (skipConfig) {
      console.log("Created .gitignore with opencode.jsonc")
      return
    }
    prompts.log.success("Created .gitignore with opencode.jsonc")
    return
  }

  const gitignoreContent = await Bun.file(gitignorePath).text()

  if (gitignoreContent.includes("opencode.jsonc")) {
    if (!skipConfig) {
      prompts.log.info("opencode.jsonc already in .gitignore")
    }
    return
  }

  const newContent = gitignoreContent.trim() + "\n\n# OpenCode config\nopencode.jsonc\n"
  await Bun.write(gitignorePath, newContent)

  if (skipConfig) {
    console.log("Added opencode.jsonc to .gitignore")
    return
  }

  prompts.log.success("Added opencode.jsonc to .gitignore")
}

function showCompletionMessage(skipConfig: boolean): void {
  if (skipConfig) {
    console.log("OpenCode initialized with default settings")
    return
  }

  UI.empty()
  prompts.outro("OpenCode initialized!")
  UI.empty()
  prompts.log.info("You can now run 'opencode' to start using OpenCode in this project.")
  prompts.log.info("To modify permissions later, edit opencode.jsonc in your project root.")
}

export const InitCommand = cmd({
  command: "init",
  describe: "initialize opencode for this project",
  builder: (yargs) =>
    yargs.option("skip", {
      type: "boolean",
      describe: "skip permission configuration and use defaults",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const skipConfig = args.skip

        if (!skipConfig) {
          UI.empty()
          prompts.intro("Initialize OpenCode")

          prompts.log.info(
            "OpenCode can ask for permission before executing commands and making changes.\nConfigure permissions below, or skip to use defaults (allow all).",
          )
          UI.empty()
        }

        const permissionConfig = skipConfig ? {} : await promptPermissions()

        await createConfigFile(permissionConfig, skipConfig ?? false)
        await generateAgentsFile(skipConfig ?? false)
        await updateGitignore(skipConfig ?? false)

        showCompletionMessage(skipConfig ?? false)
      },
    })
  },
})
