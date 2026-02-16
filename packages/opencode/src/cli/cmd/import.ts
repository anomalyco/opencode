import type { Argv } from "yargs"
import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { Instance } from "../../project/instance"
import { ShareNext } from "../../share/share-next"
import { EOL } from "os"

/** Discriminated union returned by the ShareNext API (GET /api/share/:id/data) */
export type ShareData =
  | { type: "session"; data: SDKSession }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: unknown }
  | { type: "model"; data: unknown }

/** Extract share ID from a share URL like https://opncd.ai/share/abc123 */
export function parseShareUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/[^/]+\/share\/([a-zA-Z0-9_-]+)$/)
  return match ? match[1] : null
}

/**
 * Transform ShareNext API response (flat array) into the nested structure for local file storage.
 *
 * The API returns a flat array: [session, message, message, part, part, ...]
 * Local storage expects: { info: session, messages: [{ info: message, parts: [part, ...] }, ...] }
 *
 * This groups parts by their messageID to reconstruct the hierarchy before writing to disk.
 */
export function transformShareData(shareData: ShareData[]): {
  info: SDKSession
  messages: Array<{ info: Message; parts: Part[] }>
} | null {
  const sessionItem = shareData.find((d) => d.type === "session")
  if (!sessionItem) return null

  const messageMap = new Map<string, Message>()
  const partMap = new Map<string, Part[]>()

  for (const item of shareData) {
    if (item.type === "message") {
      messageMap.set(item.data.id, item.data)
    } else if (item.type === "part") {
      if (!partMap.has(item.data.messageID)) {
        partMap.set(item.data.messageID, [])
      }
      partMap.get(item.data.messageID)!.push(item.data)
    }
  }

  if (messageMap.size === 0) return null

  return {
    info: sessionItem.data,
    messages: Array.from(messageMap.values()).map((msg) => ({
      info: msg,
      parts: partMap.get(msg.id) ?? [],
    })),
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: Message
              parts: Part[]
            }>
          }
        | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        const slug = parseShareUrl(args.file)
        if (!slug) {
          const baseUrl = await ShareNext.url()
          process.stdout.write(`Invalid URL format. Expected: ${baseUrl}/share/<slug>`)
          process.stdout.write(EOL)
          return
        }

        const baseUrl = await ShareNext.url()
        const response = await fetch(`${baseUrl}/api/share/${slug}/data`)

        if (!response.ok) {
          process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
          process.stdout.write(EOL)
          return
        }

        const shareData: ShareData[] = await response.json()
        const transformed = transformShareData(shareData)

        if (!transformed) {
          process.stdout.write(`Share not found or empty: ${slug}`)
          process.stdout.write(EOL)
          return
        }

        exportData = transformed
      } else {
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      Database.use((db) => db.insert(SessionTable).values(Session.toRow(exportData.info)).onConflictDoNothing().run())

      for (const msg of exportData.messages) {
        Database.use((db) =>
          db
            .insert(MessageTable)
            .values({
              id: msg.info.id,
              session_id: exportData.info.id,
              time_created: msg.info.time?.created ?? Date.now(),
              data: msg.info,
            })
            .onConflictDoNothing()
            .run(),
        )

        for (const part of msg.parts) {
          Database.use((db) =>
            db
              .insert(PartTable)
              .values({
                id: part.id,
                message_id: msg.info.id,
                session_id: exportData.info.id,
                data: part,
              })
              .onConflictDoNothing()
              .run(),
          )
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
