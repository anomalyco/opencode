import path from "path"
import { pathToFileURL } from "url"
import type { HandlerContext } from "@connectrpc/connect"
import { create } from "@bufbuild/protobuf"
import { Bus } from "../../bus"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import {
  PromptResponsePartSchema,
  ListSessionsResponseSchema,
  GetSessionChildrenResponseSchema,
  type PromptRequest,
  type PromptResponsePart,
  type ListSessionsRequest,
  type GetSessionRequest,
  type CreateSessionRequest,
  type UpdateSessionRequest,
  type DeleteSessionRequest,
  type ForkSessionRequest,
  type GetSessionChildrenRequest,
  type AbortSessionRequest,
} from "../gen/opencode/v1/session_pb"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import { PermissionAction } from "../gen/opencode/v1/common_pb"
import { toProtoSession } from "../mapper/session"

type Queue = {
  items: PromptResponsePart[]
  wake?: () => void
}

function push(q: Queue, part: PromptResponsePart) {
  q.items.push(part)
  q.wake?.()
  q.wake = undefined
}

function wake(q: Queue) {
  q.wake?.()
  q.wake = undefined
}

function fromEvent(event: unknown, sessionID: string) {
  if (!event || typeof event !== "object") return
  if (!("type" in event) || typeof event.type !== "string") return
  if (!("properties" in event) || !event.properties || typeof event.properties !== "object") return
  if (event.type === "message.part.updated") {
    if (!("part" in event.properties) || !event.properties.part || typeof event.properties.part !== "object") return
    if (!("sessionID" in event.properties.part) || event.properties.part.sessionID !== sessionID) return
    if (!("messageID" in event.properties.part) || typeof event.properties.part.messageID !== "string") return
    return event.properties.part.messageID
  }
  if (event.type === "message.part.delta") {
    if (!("sessionID" in event.properties) || event.properties.sessionID !== sessionID) return
    if (!("messageID" in event.properties) || typeof event.properties.messageID !== "string") return
    return event.properties.messageID
  }
}

function file(directory: string, input: string) {
  const url = URL.canParse(input) ? input : pathToFileURL(path.resolve(directory, input)).href
  const pathname = URL.canParse(url) ? new URL(url).pathname : input
  const filename = path.basename(pathname)
  return {
    type: "file" as const,
    url,
    mime: "text/plain",
    ...(filename ? { filename } : {}),
  }
}

function fromProtoPermissionRule(
  rules: { permission: string; pattern: string; action: PermissionAction }[],
): Session.Info["permission"] {
  if (!rules.length) return undefined
  return rules.map((rule) => ({
    permission: rule.permission,
    pattern: rule.pattern,
    action: rule.action === PermissionAction.ALLOW ? "allow" : rule.action === PermissionAction.DENY ? "deny" : "ask",
  }))
}

export const session = {
  async *prompt(req: PromptRequest, ctx: HandlerContext) {
    const stream = await Instance.provide({
      directory: req.directory,
      fn: async function* () {
        const q: Queue = { items: [] }
        let done = false
        const stop = Bus.subscribeAll((event: unknown) => {
          const messageID = fromEvent(event, req.sessionId)
          if (!messageID) return
          push(q, create(PromptResponsePartSchema, { messageId: messageID }))
        })

        const close = () => {
          if (done) return
          done = true
          stop()
          SessionPrompt.cancel(req.sessionId)
          wake(q)
        }

        ctx.signal.addEventListener("abort", close, { once: true })

        const prompt = SessionPrompt.prompt({
          sessionID: req.sessionId,
          parts: [{ type: "text", text: req.text }, ...req.attachments.map((item) => file(req.directory, item))],
          model:
            req.providerId && req.modelId
              ? {
                  providerID: req.providerId,
                  modelID: req.modelId,
                }
              : undefined,
          agent: req.agentId,
        }).finally(() => {
          done = true
          wake(q)
        })

        try {
          while (!ctx.signal.aborted) {
            while (q.items.length > 0) {
              const item = q.items.shift()
              if (!item) continue
              yield item
            }
            if (done) break
            await new Promise<void>((resolve) => {
              q.wake = resolve
            })
            if (done) break
          }
        } finally {
          stop()
          ctx.signal.removeEventListener("abort", close)
          if (!ctx.signal.aborted) SessionPrompt.cancel(req.sessionId)
          await prompt.catch(() => undefined)
        }
      },
    })
    for await (const item of stream) {
      yield item
    }
  },

  async list(req: ListSessionsRequest) {
    const sessions: Session.Info[] = []
    for await (const session of Session.list({
      directory: req.directory,
      roots: req.roots,
      start: req.start ? Number(req.start) : undefined,
      search: req.search,
      limit: req.limit,
    })) {
      sessions.push(session)
    }
    return create(ListSessionsResponseSchema, {
      sessions: sessions.map(toProtoSession),
    })
  },

  async get(req: GetSessionRequest) {
    const info = await Session.get(req.sessionId)
    return toProtoSession(info)
  },

  async create(req: CreateSessionRequest) {
    const info = await Session.create({
      parentID: req.parentId,
      title: req.title,
      permission: fromProtoPermissionRule(req.permission),
    })
    return toProtoSession(info)
  },

  async update(req: UpdateSessionRequest) {
    let info = await Session.get(req.sessionId)

    if (req.title !== undefined) {
      info = await Session.setTitle({ sessionID: req.sessionId, title: req.title })
    }

    if (req.archived !== undefined) {
      info = await Session.setArchived({ sessionID: req.sessionId, time: Number(req.archived) })
    }

    return toProtoSession(info)
  },

  async delete(req: DeleteSessionRequest) {
    await Session.remove(req.sessionId)
    return create(EmptySchema, {})
  },

  async fork(req: ForkSessionRequest) {
    const info = await Session.fork({
      sessionID: req.sessionId,
      messageID: req.messageId,
    })
    return toProtoSession(info)
  },

  async getChildren(req: GetSessionChildrenRequest) {
    const children = await Session.children(req.sessionId)
    return create(GetSessionChildrenResponseSchema, {
      sessions: children.map(toProtoSession),
    })
  },

  async abort(req: AbortSessionRequest) {
    SessionPrompt.cancel(req.sessionId)
    return create(EmptySchema, {})
  },
}
