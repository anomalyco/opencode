import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Log } from "../util/log"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Wildcard } from "../util/wildcard"
import { PermissionID } from "./schema"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  function toKeys(pattern: Info["pattern"], type: string): string[] {
    return pattern === undefined ? [type] : Array.isArray(pattern) ? pattern : [pattern]
  }

  function covered(keys: string[], approved: Map<string, boolean>): boolean {
    return keys.every((k) => {
      for (const p of approved.keys()) {
        if (Wildcard.match(k, p)) return true
      }
      return false
    })
  }

  export const Info = z
    .object({
      id: PermissionID.zod,
      type: z.string(),
      pattern: z.union([z.string(), z.array(z.string())]).optional(),
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      callID: z.string().optional(),
      message: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "Permission",
    })
  export type Info = z.infer<typeof Info>

  interface PendingEntry {
    info: Info
    resolve: () => void
    reject: (e: any) => void
  }

  export const Event = {
    Updated: BusEvent.define("permission.updated", Info),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        permissionID: PermissionID.zod,
        response: z.string(),
      }),
    ),
  }

  const state = Instance.state(
    () => ({
      pending: new Map<SessionID, Map<PermissionID, PendingEntry>>(),
      approved: new Map<SessionID, Map<string, boolean>>(),
    }),
    async (state) => {
      for (const session of state.pending.values()) {
        for (const item of session.values()) {
          item.reject(new RejectedError(item.info.sessionID, item.info.id, item.info.callID, item.info.metadata))
        }
      }
    },
  )

  export function pending() {
    return state().pending
  }

  export function list() {
    const { pending } = state()
    const result: Info[] = []
    for (const session of pending.values()) {
      for (const item of session.values()) {
        result.push(item.info)
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  export async function ask(input: {
    type: Info["type"]
    message: Info["message"]
    pattern?: Info["pattern"]
    callID?: Info["callID"]
    sessionID: Info["sessionID"]
    messageID: Info["messageID"]
    metadata: Info["metadata"]
  }) {
    const { pending, approved } = state()
    log.info("asking", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      toolCallID: input.callID,
      pattern: input.pattern,
    })
    const approvedForSession = approved.get(input.sessionID)
    const keys = toKeys(input.pattern, input.type)
    if (approvedForSession && covered(keys, approvedForSession)) return
    const info: Info = {
      id: PermissionID.ascending(),
      type: input.type,
      pattern: input.pattern,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      message: input.message,
      metadata: input.metadata,
      time: {
        created: Date.now(),
      },
    }

    switch (
      await Plugin.trigger("permission.ask", info, {
        status: "ask",
      }).then((x) => x.status)
    ) {
      case "deny":
        throw new RejectedError(info.sessionID, info.id, info.callID, info.metadata)
      case "allow":
        return
    }

    if (!pending.has(input.sessionID)) pending.set(input.sessionID, new Map())
    return new Promise<void>((resolve, reject) => {
      pending.get(input.sessionID)!.set(info.id, {
        info,
        resolve,
        reject,
      })
      Bus.publish(Event.Updated, info)
    })
  }

  export const Response = z.enum(["once", "always", "reject"])
  export type Response = z.infer<typeof Response>

  export function respond(input: { sessionID: Info["sessionID"]; permissionID: Info["id"]; response: Response }) {
    log.info("response", input)
    const { pending, approved } = state()
    const session = pending.get(input.sessionID)
    const match = session?.get(input.permissionID)
    if (!session || !match) return
    session.delete(input.permissionID)
    if (session.size === 0) pending.delete(input.sessionID)
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      permissionID: input.permissionID,
      response: input.response,
    })
    if (input.response === "reject") {
      match.reject(new RejectedError(input.sessionID, input.permissionID, match.info.callID, match.info.metadata))
      return
    }
    match.resolve()
    if (input.response === "always") {
      if (!approved.has(input.sessionID)) approved.set(input.sessionID, new Map())
      const approvedSession = approved.get(input.sessionID)!
      const approveKeys = toKeys(match.info.pattern, match.info.type)
      for (const k of approveKeys) {
        approvedSession.set(k, true)
      }
      const items = pending.get(input.sessionID)
      if (!items) return
      const toRespond: Info[] = []
      for (const item of items.values()) {
        const itemKeys = toKeys(item.info.pattern, item.info.type)
        if (covered(itemKeys, approvedSession)) {
          toRespond.push(item.info)
        }
      }
      for (const item of toRespond) {
        respond({
          sessionID: item.sessionID,
          permissionID: item.id,
          response: input.response,
        })
      }
    }
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: SessionID,
      public readonly permissionID: PermissionID,
      public readonly toolCallID?: string,
      public readonly metadata?: Record<string, any>,
      public readonly reason?: string,
    ) {
      super(
        reason !== undefined
          ? reason
          : `The user rejected permission to use this specific tool call. You may try again with different parameters.`,
      )
    }
  }
}
