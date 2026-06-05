import type { AgentSideConnection, PermissionOption, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { applyPatch } from "diff"
import { exists, readText } from "@/util/filesystem"
import type { ACPSession } from "./session"
import { editDiffContent, toLocations, toToolKind, type ToolInput } from "./tool"
import { Effect } from "effect"

const log = Log.create({ service: "acp-permission" })

type PermissionEvent = Extract<Event, { type: "permission.asked" }>
type Reply = "once" | "always" | "reject"
type Connection = Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>

const permissionOptions: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow once" },
  { optionId: "always", kind: "allow_always", name: "Always allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {}

  handle(event: PermissionEvent) {
    const permission = event.properties
    const previous = this.queues.get(permission.sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch((error: unknown) => {
        log.error("failed to handle permission", { error, permissionID: permission.id })
      })
      .finally(() => {
        if (this.queues.get(permission.sessionID) === next) {
          this.queues.delete(permission.sessionID)
        }
      })
    this.queues.set(permission.sessionID, next)
  }

  private async process(event: PermissionEvent) {
    const permission = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(permission.sessionID))
    if (!session) return

    if (!this.input.connection.requestPermission) {
      log.error("ACP connection cannot request permission", {
        permissionID: permission.id,
        sessionID: permission.sessionID,
      })
      await this.reply(permission.id, "reject", session.cwd)
      return
    }

    const content = editDiffContent(permission.permission, permission.metadata, permission.metadata)
    const result = await this.input.connection
      .requestPermission({
        sessionId: permission.sessionID,
        toolCall: {
          toolCallId: permission.tool?.callID ?? permission.id,
          status: "pending",
          title: permission.permission,
          rawInput: permission.metadata,
          kind: toToolKind(permission.permission),
          locations: toLocations(permission.permission, permission.metadata),
          ...(content.length ? { content } : {}),
        },
        options: permissionOptions,
      })
      .catch(async (error: unknown) => {
        log.error("failed to request permission from ACP", {
          error,
          permissionID: permission.id,
          sessionID: permission.sessionID,
        })
        await this.reply(permission.id, "reject", session.cwd)
        return undefined
      })

    if (!result) return

    const reply = selectedReply(result)
    if (reply !== "once" && reply !== "always") {
      await this.reply(permission.id, "reject", session.cwd)
      return
    }

    if (permission.permission === "edit") {
      await this.writeProposedEdit(session.id, permission.metadata).catch((error: unknown) => {
        log.error("failed to write proposed edit through ACP", {
          error,
          permissionID: permission.id,
          sessionID: permission.sessionID,
        })
      })
    }

    await this.reply(permission.id, reply, session.cwd)
  }

  private async reply(requestID: string, reply: Reply, directory: string) {
    await this.input.sdk.permission.reply({
      requestID,
      reply,
      directory,
    })
  }

  private async writeProposedEdit(sessionId: string, metadata: ToolInput) {
    if (!this.input.connection.writeTextFile) return
    if (await this.writeProposedFiles(sessionId, metadata)) return

    const filepath = stringValue(metadata.filepath)
    const diff = stringValue(metadata.diff)
    if (!filepath || !diff) return

    const content = (await exists(filepath)) ? await readText(filepath) : ""
    const next = applyPatch(content, diff)
    if (next === false) {
      log.error("Failed to apply unified diff (context mismatch)")
      return
    }

    void this.input.connection.writeTextFile({
      sessionId,
      path: filepath,
      content: next,
    })
  }

  private async writeProposedFiles(sessionId: string, metadata: ToolInput) {
    if (!Array.isArray(metadata.files)) return false

    const writes = metadata.files.flatMap((file): Array<{ path: string; content: string }> => {
      if (!file || typeof file !== "object") return []
      const info = file as Record<string, unknown>
      if (info.type === "delete") return []
      const path = stringValue(info.movePath) ?? stringValue(info.filePath)
      const content = stringValue(info.after)
      if (!path || content === undefined) return []
      return [{ path, content }]
    })
    if (!writes.length) return false

    await Promise.all(
      writes.map((write) =>
        this.input.connection.writeTextFile!({
          sessionId,
          path: write.path,
          content: write.content,
        }),
      ),
    )
    return true
  }
}

function selectedReply(result: RequestPermissionResponse): Reply {
  if (result.outcome.outcome !== "selected") return "reject"
  if (result.outcome.optionId === "once" || result.outcome.optionId === "always") return result.outcome.optionId
  return "reject"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export * as ACPPermission from "./permission"
