import z from "zod"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Wildcard } from "../util/wildcard"
import { Session } from "../session"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  function toKeys(pattern: Info["pattern"], type: string): string[] {
    return pattern === undefined ? [type] : Array.isArray(pattern) ? pattern : [pattern]
  }

  function covered(keys: string[], approved: Record<string, boolean>): boolean {
    const pats = Object.keys(approved)
    return keys.every((k) => pats.some((p) => Wildcard.match(k, p)))
  }

  export const Info = z
    .object({
      id: z.string(),
      type: z.string(),
      pattern: z.union([z.string(), z.array(z.string())]).optional(),
      sessionID: z.string(),
      messageID: z.string(),
      callID: z.string().optional(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "Permission",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: Bus.event("permission.updated", Info),
    Replied: Bus.event(
      "permission.replied",
      z.object({
        sessionID: z.string(),
        permissionID: z.string(),
        response: z.string(),
      }),
    ),
  }

  const state = Instance.state(
    () => {
      const pending: {
        [sessionID: string]: {
          [permissionID: string]: {
            info: Info
            resolve: () => void
            reject: (e: any) => void
          }
        }
      } = {}

      const approved: {
        [sessionID: string]: {
          [permissionID: string]: boolean
        }
      } = {}

      return {
        pending,
        approved,
      }
    },
    async (state) => {
      for (const pending of Object.values(state.pending)) {
        for (const item of Object.values(pending)) {
          item.reject(new RejectedError(item.info.sessionID, item.info.id, item.info.callID, item.info.metadata))
        }
      }
    },
  )

  export function pending() {
    return state().pending
  }

  export async function ask(input: {
    type: Info["type"]
    title: Info["title"]
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
    const approvedForSession = approved[input.sessionID] || {}
    const keys = toKeys(input.pattern, input.type)
    if (covered(keys, approvedForSession)) return
    const info: Info = {
      id: Identifier.ascending("permission"),
      type: input.type,
      pattern: input.pattern,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      title: input.title,
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

    pending[input.sessionID] = pending[input.sessionID] || {}
    return new Promise<void>((resolve, reject) => {
      pending[input.sessionID][info.id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Updated, info)

      // Forward permission to parent session if this is a child session
      Session.get(input.sessionID)
        .then((session) => {
          if (session.parentID) {
            const forwardedInfo: Info = {
              ...info,
              sessionID: session.parentID,
              metadata: {
                ...info.metadata,
                originSessionID: input.sessionID,
                originSessionTitle: session.title,
              },
            }
            // Add to parent's pending list as well so responses work
            pending[session.parentID] = pending[session.parentID] || {}
            pending[session.parentID][info.id] = {
              info: forwardedInfo,
              resolve, // Same resolve/reject as child - they should be linked
              reject,
            }
            Bus.publish(Event.Updated, forwardedInfo)
          }
        })
        .catch(() => {
          // Session not found, ignore
        })
    })
  }

  export const Response = z.enum(["once", "always", "reject"])
  export type Response = z.infer<typeof Response>

  export function respond(input: { sessionID: Info["sessionID"]; permissionID: Info["id"]; response: Response }) {
    log.info("response", input)
    const { pending, approved } = state()
    const match = pending[input.sessionID]?.[input.permissionID]
    if (!match) return

    // Check if this is a forwarded permission from a child session
    const originSessionID = match.info.metadata?.originSessionID as string | undefined

    // Remove from current session's pending list
    delete pending[input.sessionID][input.permissionID]
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      permissionID: input.permissionID,
      response: input.response,
    })

    // If this was forwarded from a child, also remove from child's pending list
    if (originSessionID && pending[originSessionID]?.[input.permissionID]) {
      delete pending[originSessionID][input.permissionID]
      Bus.publish(Event.Replied, {
        sessionID: originSessionID,
        permissionID: input.permissionID,
        response: input.response,
      })
    }

    if (input.response === "reject") {
      match.reject(new RejectedError(input.sessionID, input.permissionID, match.info.callID, match.info.metadata))
      return
    }
    match.resolve()
    if (input.response === "always") {
      approved[input.sessionID] = approved[input.sessionID] || {}
      const approveKeys = toKeys(match.info.pattern, match.info.type)
      for (const k of approveKeys) {
        approved[input.sessionID][k] = true
      }

      // Also approve for the origin session if this was forwarded
      if (originSessionID) {
        approved[originSessionID] = approved[originSessionID] || {}
        for (const k of approveKeys) {
          approved[originSessionID][k] = true
        }
      }

      const items = pending[input.sessionID]
      if (!items) return
      for (const item of Object.values(items)) {
        const itemKeys = toKeys(item.info.pattern, item.info.type)
        if (covered(itemKeys, approved[input.sessionID])) {
          respond({
            sessionID: item.info.sessionID,
            permissionID: item.info.id,
            response: input.response,
          })
        }
      }
    }
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: string,
      public readonly permissionID: string,
      public readonly toolCallID?: string,
      public readonly metadata?: Record<string, any>,
    ) {
      super(`The user rejected permission to use this specific tool call. You may try again with different parameters.`)
    }
  }
}
