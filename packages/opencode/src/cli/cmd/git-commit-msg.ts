import type { Argv } from "yargs"
import { App } from "../../app/app"
import { Provider } from "../../provider/provider"
import { Session } from "../../session"
import { Share } from "../../share/share"
import { Message } from "../../session/message"
import { Bus } from "../../bus"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export const GitCommitMsgCommand = cmd({
  command: "git-commit-msg",
  describe: "Generate a conventional commit message from staged changes",
  builder: (yargs: Argv) => {
    return yargs
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "Model to use in the format of provider/model",
      })
      .option("copy", {
        type: "boolean",
        alias: ["c"],
        describe: "Copy the generated commit message to clipboard",
        default: false,
      })
  },
  handler: async (args) => {
    await App.provide(
      {
        cwd: process.cwd(),
      },
      async () => {
        try {
          // check if we're in a git repository
          await execAsync("git rev-parse --git-dir")
        } catch (error) {
          UI.error("Not in a git repository")
          return
        }

        // get git diff for staged changes (what will be committed)
        let gitDiff: string

        try {
          const { stdout } = await execAsync("git diff --cached")
          gitDiff = stdout.trim()

          if (!gitDiff) {
            UI.error("No staged changes found. Run 'git add' first.")
            return
          }
        } catch (error) {
          UI.error("Failed to get git diff")
          return
        }

        await Share.init()
        const session = await Session.create()

        UI.empty()
        UI.println(UI.logo())
        UI.empty()
        UI.println(UI.Style.TEXT_NORMAL_BOLD + "> ", "Generating conventional commit message...")
        UI.empty()

        const { providerID, modelID } = args.model
          ? Provider.parseModel(args.model)
          : await Provider.defaultModel()

        UI.println(
          UI.Style.TEXT_NORMAL_BOLD + "@ ",
          UI.Style.TEXT_NORMAL + `${providerID}/${modelID}`,
        )
        UI.empty()

        const prompt = `You are an expert at following the Conventional Commit specification. Based on the following git diff, generate a conventional commit message that follows the format:

<type>[optional scope]: <description>

[optional body]

[optional footer(s)]

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert

Rules:
- Use lowercase for type and description
- Keep description under 50 characters
- Use imperative mood (e.g., "add" not "added")
- Include scope if changes are focused on a specific area
- Add body if more context is needed
- Only return the commit message, no additional text

Git diff:
${gitDiff}`

        let commitMessage = ""

        Bus.subscribe(Message.Event.PartUpdated, async (evt) => {
          if (evt.properties.sessionID !== session.id) return
          const part = evt.properties.part

          if (part.type === "text") {
            commitMessage += part.text
          }
        })

        await Session.chat({
          sessionID: session.id,
          providerID,
          modelID,
          parts: [
            {
              type: "text",
              text: prompt,
            },
          ],
        })

        if (commitMessage.trim()) {
          const cleanMessage = commitMessage.trim()

          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Generated commit message:")
          UI.empty()
          UI.println(cleanMessage)
          UI.empty()

          if (args.copy) {
            try {
              // try different clipboard commands based on platform
              const platform = process.platform
              let copyCommand: string

              if (platform === "darwin") {
                copyCommand = "pbcopy"
              } else if (platform === "linux") {
                copyCommand = "xclip -selection clipboard"
              } else if (platform === "win32") {
                copyCommand = "clip"
              } else {
                throw new Error("Unsupported platform")
              }

              await execAsync(`echo "${cleanMessage.replace(/"/g, '\\"')}" | ${copyCommand}`)
              UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Copied to clipboard!")
              UI.empty()
            } catch (error) {
              UI.println(UI.Style.TEXT_WARNING_BOLD + "⚠ Failed to copy to clipboard")
              UI.empty()
            }
          }

          UI.println(UI.Style.TEXT_INFO + "To use this message, run:")
          UI.println(UI.Style.TEXT_INFO + `git commit -m "${cleanMessage.replace(/"/g, '\\"')}"`)
        }

        UI.empty()
      },
    )
  },
})
