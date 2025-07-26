import { App } from "../app/app"
import { z } from "zod"
import { Bus } from "../bus"
import { Log } from "../util/log"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      title: z.string(),
      metadata: z.record(z.any()),
      time: z.object({
        created: z.number(),
      }),
    })
    .openapi({
      ref: "permission.info",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: Bus.event("permission.updated", Info),
  }

  const state = App.state(
    "permission",
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
          [permissionID: string]: Info
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
          item.reject(new RejectedError(item.info.sessionID, item.info.id))
        }
      }
    },
  )

  export function ask(input: {
    id: Info["id"]
    sessionID: Info["sessionID"]
    title: Info["title"]
    metadata: Info["metadata"]
  }) {
    const { pending, approved } = state()
    log.info("asking for permission", {
      sessionID: input.sessionID,
      permissionID: input.id,
      title: input.title,
    })
    if (approved[input.sessionID]?.[input.id]) {
      log.info("previously approved", {
        sessionID: input.sessionID,
        permissionID: input.id,
      })
      return
    }
    const info: Info = {
      id: input.id,
      sessionID: input.sessionID,
      title: input.title,
      metadata: input.metadata,
      time: {
        created: Date.now(),
      },
    }
    pending[input.sessionID] = pending[input.sessionID] || {}
    return new Promise<void>((resolve, reject) => {
      pending[input.sessionID][input.id] = {
        info,
        resolve,
        reject,
      }
      // Auto-approve in headless/CLI environments, but wait for user input in TUI
      const isHeadless = !process.stdout.isTTY || process.env.NODE_ENV === "test"
      
      if (isHeadless) {
        // In CLI/headless environments, auto-approve after short delay for better UX
        setTimeout(() => {
          respond({
            sessionID: input.sessionID,
            permissionID: input.id,
            response: "always",
          })
        }, 100) // Shorter delay for CLI
      }
      
      Bus.publish(Event.Updated, info)
    })
  }

  export function respond(input: {
    sessionID: Info["sessionID"]
    permissionID: Info["id"]
    response: "once" | "always" | "reject"
  }) {
    log.info("response received", input)
    const { pending, approved } = state()
    log.info("pending permissions", { pending: Object.keys(pending), sessionID: input.sessionID })
    if (pending[input.sessionID]) {
      log.info("session permissions", { permissions: Object.keys(pending[input.sessionID]) })
    }
    const match = pending[input.sessionID]?.[input.permissionID]
    if (!match) {
      log.error("no matching permission found", { sessionID: input.sessionID, permissionID: input.permissionID })
      return
    }
    log.info("resolving permission", { sessionID: input.sessionID, permissionID: input.permissionID })
    delete pending[input.sessionID][input.permissionID]
    if (input.response === "reject") {
      match.reject(new RejectedError(input.sessionID, input.permissionID))
      return
    }
    match.resolve()
    if (input.response === "always") {
      approved[input.sessionID] = approved[input.sessionID] || {}
      approved[input.sessionID][input.permissionID] = match.info
    }
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: string,
      public readonly permissionID: string,
    ) {
      super(`The user rejected permission to use this functionality`)
    }
  }
}
