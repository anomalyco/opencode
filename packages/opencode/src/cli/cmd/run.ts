import type { Argv } from "yargs"
import { App } from "../../app/app"
import { Bus } from "../../bus"
import { Provider } from "../../provider/provider"
import { Session } from "../../session"
import { Share } from "../../share/share"
import { Message } from "../../session/message"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { Config } from "../../config/config"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
  },
  handler: async (args) => {
    const message = args.message.join(" ")
    await App.provide(
      {
        cwd: process.cwd(),
      },
      async () => {
        await Share.init()
        const session = await (async () => {
          if (args.continue) {
            const first = await Session.list().next()
            if (first.done) return
            return first.value
          }

          if (args.session) return Session.get(args.session)

          return Session.create()
        })()

        if (!session) {
          UI.error("Session not found")
          return
        }

        UI.empty()
        UI.println(UI.logo())
        UI.empty()
        UI.println(UI.Style.TEXT_NORMAL_BOLD + "> ", message)
        UI.empty()

        const cfg = await Config.get()
        if (cfg.autoshare || Flag.OPENCODE_AUTO_SHARE || args.share) {
          await Session.share(session.id)
          UI.println(
            UI.Style.TEXT_INFO_BOLD +
            "~  https://opencode.ai/s/" +
            session.id.slice(-8),
          )
        }
        UI.empty()

        const { providerID, modelID } = args.model
          ? Provider.parseModel(args.model)
          : await Provider.defaultModel()
        UI.println(
          UI.Style.TEXT_NORMAL_BOLD + "@ ",
          UI.Style.TEXT_NORMAL + `${providerID}/${modelID}`,
        )
        UI.empty()

        function printEvent(color: string, type: string, title: string) {
          UI.println(
            color + `|`,
            UI.Style.TEXT_NORMAL +
            UI.Style.TEXT_DIM +
            ` ${type.padEnd(7, " ")}`,
            "",
            UI.Style.TEXT_NORMAL + title,
          )
        }

        Bus.subscribe(Message.Event.PartUpdated, async (evt) => {
          if (evt.properties.sessionID !== session.id) return
          const part = evt.properties.part
          const message = await Session.getMessage(
            evt.properties.sessionID,
            evt.properties.messageID,
          )

          if (
            part.type === "tool-invocation" &&
            part.toolInvocation.state === "result"
          ) {
            const metadata =
              message.metadata.tool[part.toolInvocation.toolCallId]
            const [tool, color] = TOOL[part.toolInvocation.toolName] ?? [
              part.toolInvocation.toolName,
              UI.Style.TEXT_INFO_BOLD,
            ]
            printEvent(color, tool, metadata?.title || 'Unknown')
          }

          if (part.type === "text") {
            if (part.text.includes("\n")) {
              UI.empty()
              UI.println(part.text)
              UI.empty()
              return
            }
            printEvent(UI.Style.TEXT_NORMAL_BOLD, "Text", part.text)
          }
        })
        await Session.chat({
          sessionID: session.id,
          providerID,
          modelID,
          parts: [
            {
              type: "text",
              text: message,
            },
          ],
        })
        UI.empty()
      },
    )
  },
})
