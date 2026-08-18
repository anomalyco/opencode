import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "@/session/session"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { InstanceRef } from "@/effect/instance-ref"
import { ShareNext } from "@/share/share-next"
import { EOL } from "os"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Cause, Effect, Exit, Schema } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import { inArray } from "drizzle-orm"
import { SessionTransferFile } from "./session-transfer"

function sessionTransferSessions(file: SessionTransferFile) {
  return "sessions" in file ? file.sessions : [file]
}

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

  let raw: unknown

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

    raw = transformed
  } else {
    raw = yield* fs
      .readJson(file)
      .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))
  }

  if (!raw) {
    process.stdout.write(`Failed to read session data`)
    process.stdout.write(EOL)
    return
  }

  const decoded = Schema.decodeUnknownExit(SessionTransferFile)(raw)
  if (Exit.isFailure(decoded)) {
    return yield* fail(`Invalid session data: ${String(Cause.squash(decoded.cause))}`)
  }
  const transfer = decoded.value as SessionTransferFile
  yield* importSessionTransfer(transfer, ctx)

  process.stdout.write(`Imported session: ${"sessions" in transfer ? transfer.rootSessionID : transfer.info.id}`)
  process.stdout.write(EOL)
})

export const importSessionTransfer = Effect.fn("Cli.import.transfer")(function* (
  transfer: SessionTransferFile,
  ctx: InstanceContext,
) {
  if ("sessions" in transfer && !transfer.sessions.some((session) => session.info.id === transfer.rootSessionID)) {
    yield* fail(`Archive root Session is missing: ${transfer.rootSessionID}`)
  }

  const targetPath = path.relative(path.resolve(ctx.worktree), ctx.directory).replaceAll("\\", "/")
  const records = sessionTransferSessions(transfer).map((data) => ({
    data,
    row: Session.toRow({
      ...data.info,
      projectID: ctx.project.id,
      directory: ctx.directory,
      path: targetPath,
    }),
  }))
  const included = new Set(records.map((record) => record.row.id))
  const { db } = yield* Database.Service

  yield* db
    .transaction(
      (tx) =>
        Effect.gen(function* () {
          const existing = yield* tx
            .select({
              id: SessionTable.id,
              projectID: SessionTable.project_id,
              directory: SessionTable.directory,
              path: SessionTable.path,
            })
            .from(SessionTable)
            .where(inArray(SessionTable.id, [...included]))
            .all()
            .pipe(Effect.orDie)
          const moving = existing
            .filter(
              (session) =>
                session.projectID !== ctx.project.id ||
                session.directory !== ctx.directory ||
                (session.path ?? undefined) !== targetPath,
            )
            .map((session) => session.id)
          if (moving.length > 0) {
            const children = yield* tx
              .select({ id: SessionTable.id, parentID: SessionTable.parent_id })
              .from(SessionTable)
              .where(inArray(SessionTable.parent_id, moving))
              .all()
              .pipe(Effect.orDie)
            const omitted = children.find((child) => !included.has(child.id))
            if (omitted) {
              yield* fail(
                `Cannot move Session ${omitted.parentID} because subagent Session ${omitted.id} would remain in the current project`,
              )
            }
          }

          yield* Effect.forEach(
            records,
            (record) =>
              Effect.gen(function* () {
                yield* tx
                  .insert(SessionTable)
                  .values(record.row)
                  .onConflictDoUpdate({
                    target: SessionTable.id,
                    set: {
                      project_id: record.row.project_id,
                      directory: record.row.directory,
                      path: record.row.path,
                    },
                  })
                  .run()
                  .pipe(Effect.orDie)

                const messages = record.data.messages.map((message) => {
                  const { id, sessionID: _, ...data } = message.info
                  return {
                    id,
                    session_id: record.row.id,
                    time_created: message.info.time.created,
                    data: data as never,
                  }
                })
                if (messages.length > 0) {
                  yield* tx.insert(MessageTable).values(messages).onConflictDoNothing().run().pipe(Effect.orDie)
                }

                const parts = record.data.messages.flatMap((message) =>
                  message.parts.map((part) => {
                    const { id, sessionID: _, messageID, ...data } = part
                    return {
                      id,
                      message_id: messageID,
                      session_id: record.row.id,
                      data,
                    }
                  }),
                )
                if (parts.length > 0) {
                  yield* tx.insert(PartTable).values(parts).onConflictDoNothing().run().pipe(Effect.orDie)
                }
              }),
            { discard: true },
          )
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
})
