import type { Argv } from "yargs"
import { Bus } from "../../bus"
import { Provider } from "../../provider/provider"
import { Session } from "../../session"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"
import { MessageV2 } from "../../session/message-v2"
import { Mode } from "../../session/mode"
import { Identifier } from "../../id/id"

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
      .option("mode", {
        type: "string",
        describe: "mode to use",
      })
  },
  handler: async (args) => {
    let message = args.message.join(" ")

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    await bootstrap({ cwd: process.cwd() }, async () => {
      const session = await (async () => {
        if (args.continue) {
          const list = Session.list()
          const first = await list.next()
          await list.return()
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

      const cfg = await Config.get()
      if (cfg.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share) {
        try {
          await Session.share(session.id)
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  https://opencode.ai/s/" + session.id.slice(-8))
        } catch (error) {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          } else {
            throw error
          }
        }
      }
      UI.empty()

      const { providerID, modelID } = args.model ? Provider.parseModel(args.model) : await Provider.defaultModel()
      UI.println(UI.Style.TEXT_NORMAL_BOLD + "@ ", UI.Style.TEXT_NORMAL + `${providerID}/${modelID}`)
      UI.empty()

      function printEvent(color: string, type: string, title: string) {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      let text = ""
      Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        const part = evt.properties.part

        if (part.type === "tool" && part.state.status === "completed") {
          const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
          printEvent(color, tool, part.state.title || "Unknown")
        }

        if (part.type === "text") {
          text = part.text

          if (part.time?.end) {
            UI.empty()
            UI.println(UI.markdown(text))
            UI.empty()
            text = ""
            return
          }
        }
      })

      let errorMsg: string | undefined
      Bus.subscribe(Session.Event.Error, async (evt) => {
        const { sessionID, error } = evt.properties
        if (sessionID !== session.id || !error) return
        let err = String(error.name)

        if ("data" in error && error.data && "message" in error.data) {
          err = error.data.message
        }
        errorMsg = errorMsg ? errorMsg + "\n" + err : err

        UI.error(err)
      })

      const mode = args.mode ? await Mode.get(args.mode) : await Mode.list().then((x) => x[0])

      const messageID = Identifier.ascending("message")
      const result = await Session.chat({
        sessionID: session.id,
        messageID,
        ...(mode.model
          ? mode.model
          : {
              providerID,
              modelID,
            }),
        mode: mode.name,
        parts: [
          {
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: messageID,
            type: "text",
            text: message,
          },
        ],
      })

      const isPiped = !process.stdout.isTTY
      if (isPiped) {
        const match = result.parts.findLast((x) => x.type === "text")
        if (match) process.stdout.write(UI.markdown(match.text))
        if (errorMsg) process.stdout.write(errorMsg)
      }
      UI.empty()
    })
  },
})
