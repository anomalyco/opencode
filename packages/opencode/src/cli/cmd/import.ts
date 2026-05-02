import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "@/session/session"
import { MessageV2 } from "../../session/message-v2"
import { CliError, effectCmd } from "../effect-cmd"
import { Database } from "@/storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { ShareNext } from "@/share/share-next"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { Effect, Schema } from "effect"

const decodeMessageInfo = Schema.decodeUnknownSync(MessageV2.Info)
const decodePart = Schema.decodeUnknownSync(MessageV2.Part)

/** Discriminated union returned by the ShareNext API (GET /api/shares/:id/data) */
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

export function shouldAttachShareAuthHeaders(shareUrl: string, accountBaseUrl: string): boolean {
  try {
    return new URL(shareUrl).origin === new URL(accountBaseUrl).origin
  } catch {
    return false
  }
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

type ExportData = { info: SDKSession; messages: Array<{ info: Message; parts: Part[] }> }

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    // effectCmd always provides InstanceRef via InstanceStore.Service.provide; this is an invariant.
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    const store = yield* InstanceStore.Service
    // Ensure store.dispose runs disposers and emits server.instance.disposed
    // on every exit path: success, early return, typed failure, defect, interrupt.
    return yield* runImport(args.file, ctx.project.id).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, projectID: string) {
  const share = yield* ShareNext.Service

  let exportData: ExportData | undefined

  const isUrl = file.startsWith("http://") || file.startsWith("https://")

  if (isUrl) {
    const slug = parseShareUrl(file)
    if (!slug) {
      const baseUrl = yield* Effect.orDie(share.url())
      process.stdout.write(`Invalid URL format. Expected: ${baseUrl}/share/<slug>`)
      process.stdout.write(EOL)
      return
    }

    const baseUrl = new URL(file).origin
    const req = yield* Effect.orDie(share.request())
    const headers = shouldAttachShareAuthHeaders(file, req.baseUrl) ? req.headers : {}

    const tryFetch = (url: string) =>
      Effect.tryPromise({
        try: () => fetch(url, { headers }),
        catch: (e) =>
          new CliError({
            message: `Failed to fetch share data: ${e instanceof Error ? e.message : String(e)}`,
          }),
      })

    const dataPath = req.api.data(slug)
    let response = yield* tryFetch(`${baseUrl}${dataPath}`)

    if (!response.ok && dataPath !== `/api/share/${slug}/data`) {
      response = yield* tryFetch(`${baseUrl}/api/share/${slug}/data`)
    }

    if (!response.ok) {
      process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
      process.stdout.write(EOL)
      return
    }

    const shareData = yield* Effect.tryPromise({
      try: () => response.json() as Promise<ShareData[]>,
      catch: () => new CliError({ message: "Share data was not valid JSON" }),
    })
    const transformed = transformShareData(shareData)

    if (!transformed) {
      process.stdout.write(`Share not found or empty: ${slug}`)
      process.stdout.write(EOL)
      return
    }

    exportData = transformed
  } else {
    exportData = yield* Effect.promise(() =>
      Filesystem.readJson<NonNullable<typeof exportData>>(file).catch(() => undefined),
    )
    if (!exportData) {
      process.stdout.write(`File not found: ${file}`)
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
    projectID,
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
