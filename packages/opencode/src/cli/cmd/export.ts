import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { t } from "../../i18n"

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID
      process.stderr.write(t("export.exporting_session", { id: sessionID ?? t("export.latest") }))

      if (!sessionID) {
        UI.empty()
        prompts.intro(t("session.export"), {
          output: process.stderr,
        })

        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        if (sessions.length === 0) {
          prompts.log.error(t("export.no_sessions"), {
            output: process.stderr,
          })
          prompts.outro(t("upgrade.done"), {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: t("export.select_session"),
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession as string

        prompts.outro(t("export.exporting"), {
          output: process.stderr,
        })
      }

      try {
        const sessionInfo = await Session.get(sessionID!)
        const messages = await Session.messages({ sessionID: sessionID! })

        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
        }

        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch (error) {
        UI.error(t("export.session_not_found", { id: sessionID! }))
        process.exit(1)
      }
    })
  },
})
