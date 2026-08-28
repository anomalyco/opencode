import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { MessageV2 } from "../../session/message-v2"
import { CliError, effectCmd } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { InstanceRef } from "@/effect/instance-ref"
import { ShareNext } from "@/share/share-next"
import { EOL } from "os"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import type { InstanceContext } from "@/project/instance-context"

const decodeMessageInfo = Schema.decodeUnknownSync(SessionV1.Info)
const decodePart = Schema.decodeUnknownSync(SessionV1.Part)

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

export function formatImportFileError(file: string, error: FSUtil.Error) {
  if (error._tag === "PlatformError") {
    if (error.reason._tag === "NotFound") return `File not found: ${file}`
    if (error.reason._tag === "PermissionDenied") return `Failed to read file: Permission denied`
    return `Failed to read file: ${error.message}`
  }

  const detail = error.cause instanceof Error ? error.cause.message : error.message
  return `Invalid JSON in ${file}: ${detail}`
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
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, ctx: InstanceContext) {
  const share = yield* ShareNext.Service
  const fs = yield* FSUtil.Service
  const { db } = yield* Database.Service

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
    exportData = (yield* fs
      .readJson(file)
      .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))) as ExportData
  }

  if (!exportData) {
    process.stdout.write(`Failed to read session data`)
    process.stdout.write(EOL)
    return
  }

  const info = Schema.decodeUnknownSync(Session.Info)({
    ...exportData.info,
    projectID: ctx.project.id,
    directory: ctx.directory,
    path: path.relative(path.resolve(ctx.worktree), ctx.directory).replaceAll("\\", "/"),
  }) as Session.Info
  const row = Session.toRow(info)
  yield* db
    .insert(SessionTable)
    .values(row)
    .onConflictDoUpdate({
      target: SessionTable.id,
      set: { project_id: row.project_id, directory: row.directory, path: row.path },
    })
    .run()
    .pipe(Effect.orDie)

  for (const msg of exportData.messages) {
    const msgInfo = decodeMessageInfo(msg.info) as SessionV1.Info
    const { id, sessionID: _, ...msgData } = msgInfo
    yield* db
      .insert(MessageTable)
      .values({
        id,
        session_id: row.id,
        time_created: msgInfo.time?.created ?? Date.now(),
        data: msgData as never,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    for (const part of msg.parts) {
      const partInfo = decodePart(part) as SessionV1.Part
      const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
      yield* db
        .insert(PartTable)
        .values({
          id: partId,
          message_id: messageID,
          session_id: row.id,
          data: partData,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    }
  }

  process.stdout.write(`Imported session: ${exportData.info.id}`)
  process.stdout.write(EOL)
})
