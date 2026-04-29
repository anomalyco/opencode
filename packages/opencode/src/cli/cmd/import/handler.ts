import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "@/session/session"
import { MessageV2 } from "../../../session/message-v2"
import { bootstrap } from "../../bootstrap"
import { Database } from "@/storage/db"
import { SessionTable, MessageTable, PartTable } from "../../../session/session.sql"
import { Instance } from "../../../project/instance"
import { ShareNext } from "@/share/share-next"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { AppRuntime } from "@/effect/app-runtime"
import { Schema } from "effect"
import { parseShareUrl, shouldAttachShareAuthHeaders, transformShareData, type ShareData } from "./util"
import type { ImportArgs } from "./command"

const decodeMessageInfo = Schema.decodeUnknownSync(MessageV2.Info)
const decodePart = Schema.decodeUnknownSync(MessageV2.Part)

export async function handler(args: ImportArgs) {
  await bootstrap(process.cwd(), async () => {
    let exportData:
      | {
          info: SDKSession
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
        const baseUrl = await AppRuntime.runPromise(ShareNext.Service.use((svc) => svc.url()))
        process.stdout.write(`Invalid URL format. Expected: ${baseUrl}/share/<slug>`)
        process.stdout.write(EOL)
        return
      }

      const parsed = new URL(args.file)
      const baseUrl = parsed.origin
      const req = await AppRuntime.runPromise(ShareNext.Service.use((svc) => svc.request()))
      const headers = shouldAttachShareAuthHeaders(args.file, req.baseUrl) ? req.headers : {}

      const dataPath = req.api.data(slug)
      let response = await fetch(`${baseUrl}${dataPath}`, {
        headers,
      })

      if (!response.ok && dataPath !== `/api/share/${slug}/data`) {
        response = await fetch(`${baseUrl}/api/share/${slug}/data`, {
          headers,
        })
      }

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
      exportData = await Filesystem.readJson<NonNullable<typeof exportData>>(args.file).catch(() => undefined)
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

    const info = Schema.decodeUnknownSync(Session.Info)({
      ...exportData.info,
      projectID: Instance.project.id,
    }) as Session.Info
    const row = Session.toRow(info)
    Database.use((db) =>
      db
        .insert(SessionTable)
        .values(row)
        .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
        .run(),
    )

    for (const msg of exportData.messages) {
      const msgInfo = decodeMessageInfo(msg.info) as MessageV2.Info
      const { id, sessionID: _, ...msgData } = msgInfo
      Database.use((db) =>
        db
          .insert(MessageTable)
          .values({
            id,
            session_id: row.id,
            time_created: msgInfo.time?.created ?? Date.now(),
            data: msgData,
          })
          .onConflictDoNothing()
          .run(),
      )

      for (const part of msg.parts) {
        const partInfo = decodePart(part) as MessageV2.Part
        const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
        Database.use((db) =>
          db
            .insert(PartTable)
            .values({
              id: partId,
              message_id: messageID,
              session_id: row.id,
              data: partData,
            })
            .onConflictDoNothing()
            .run(),
        )
      }
    }

    process.stdout.write(`Imported session: ${exportData.info.id}`)
    process.stdout.write(EOL)
  })
}
