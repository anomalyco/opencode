import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Identifier } from "../id/id"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import {
  IntentInfo as IntentInfoSchema,
  IntentResponse as IntentResponseSchema,
  Intent as IntentType,
  FormIntent,
  ConfirmIntent,
  SelectIntent,
  MultiSelectIntent,
  ToastIntent,
} from "./types"

export * from "./types"

export namespace Intent {
  const log = Log.create({ service: "intent" })

  export const IntentInfo = IntentInfoSchema
  export const IntentResponse = IntentResponseSchema

  export const Event = {
    Updated: BusEvent.define("intent.updated", IntentInfoSchema),
    Replied: BusEvent.define(
      "intent.replied",
      z.object({
        sessionID: z.string(),
        intentID: z.string(),
        response: IntentResponseSchema,
      }),
    ),
  }

  export const CancelledError = NamedError.create(
    "IntentCancelledError",
    z.object({
      intentID: z.string(),
      sessionID: z.string(),
    }),
  )

  export const TimeoutError = NamedError.create(
    "IntentTimeoutError",
    z.object({
      intentID: z.string(),
      sessionID: z.string(),
      timeout: z.number(),
    }),
  )

  type PendingIntent = {
    info: z.infer<typeof IntentInfoSchema>
    resolve: (response: z.infer<typeof IntentResponseSchema>) => void
    reject: (error: Error) => void
  }

  const state = Instance.state(
    () => {
      const pending: {
        [sessionID: string]: {
          [intentID: string]: PendingIntent
        }
      } = {}

      return { pending }
    },
    async (entry) => {
      for (const session of Object.values(entry.pending)) {
        for (const item of Object.values(session)) {
          item.reject(
            new CancelledError({
              intentID: item.info.id,
              sessionID: item.info.sessionID,
            }),
          )
        }
      }
    },
  )

  export async function request(input: {
    intent: z.input<typeof IntentType>
    sessionID: string
    messageID: string
    callID?: string
    source?: "core" | "plugin"
    plugin?: string
    timeout?: number
  }): Promise<z.infer<typeof IntentResponseSchema>> {
    const id = Identifier.ascending("intent")
    const parsedIntent = IntentType.parse(input.intent)

    const info: z.infer<typeof IntentInfoSchema> = {
      id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source ?? "core",
      plugin: input.plugin,
      intent: parsedIntent,
      time: {
        created: Date.now(),
      },
    }

    log.info("requesting intent", {
      id,
      type: input.intent.type,
      sessionID: input.sessionID,
    })

    if (input.intent.type === "toast") {
      Bus.publish(Event.Updated, info)
      return { type: "submit" }
    }

    const { pending } = state()
    if (!pending[input.sessionID]) {
      pending[input.sessionID] = {}
    }

    return new Promise<z.infer<typeof IntentResponseSchema>>((resolve, reject) => {
      pending[input.sessionID][id] = {
        info,
        resolve,
        reject,
      }

      Bus.publish(Event.Updated, info)

      if (input.timeout) {
        setTimeout(() => {
          const p = pending[input.sessionID]?.[id]
          if (p) {
            delete pending[input.sessionID][id]
            reject(
              new TimeoutError({
                intentID: id,
                sessionID: input.sessionID,
                timeout: input.timeout!,
              }),
            )
          }
        }, input.timeout)
      }
    })
  }

  export function respond(input: {
    sessionID: string
    intentID: string
    response: z.infer<typeof IntentResponseSchema>
  }): boolean {
    const { pending } = state()
    const p = pending[input.sessionID]?.[input.intentID]
    if (!p) {
      log.warn("intent not found", {
        intentID: input.intentID,
        sessionID: input.sessionID,
      })
      return false
    }

    log.info("responding to intent", {
      intentID: input.intentID,
      sessionID: input.sessionID,
      responseType: input.response.type,
    })

    delete pending[input.sessionID][input.intentID]
    if (Object.keys(pending[input.sessionID]).length === 0) {
      delete pending[input.sessionID]
    }

    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      intentID: input.intentID,
      response: input.response,
    })

    if (input.response.type === "cancel") {
      p.reject(
        new CancelledError({
          intentID: input.intentID,
          sessionID: input.sessionID,
        }),
      )
      return true
    }

    p.resolve(input.response)
    return true
  }

  export function list(sessionID?: string): z.infer<typeof IntentInfoSchema>[] {
    const { pending } = state()
    if (sessionID) {
      return Object.values(pending[sessionID] ?? {}).map((p) => p.info)
    }
    return Object.values(pending)
      .flatMap((session) => Object.values(session).map((p) => p.info))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  export function cancelAll(sessionID: string): void {
    const { pending } = state()
    const session = pending[sessionID]
    if (!session) return

    log.info("cancelling all intents for session", { sessionID })

    for (const [intentID, p] of Object.entries(session)) {
      p.reject(
        new CancelledError({
          intentID,
          sessionID,
        }),
      )
    }
    delete pending[sessionID]
  }

  export async function form(
    input: Omit<z.input<typeof FormIntent>, "type"> & {
      sessionID: string
      messageID: string
      callID?: string
      source?: "core" | "plugin"
      plugin?: string
      timeout?: number
    },
  ): Promise<Record<string, any>> {
    const response = await request({
      intent: { type: "form", ...input },
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source,
      plugin: input.plugin,
      timeout: input.timeout,
    })

    if (response.type === "cancel") {
      throw new CancelledError({
        intentID: "form",
        sessionID: input.sessionID,
      })
    }

    return response.data ?? {}
  }

  export async function confirm(
    input: Omit<z.input<typeof ConfirmIntent>, "type"> & {
      sessionID: string
      messageID: string
      callID?: string
      source?: "core" | "plugin"
      plugin?: string
      timeout?: number
    },
  ): Promise<boolean> {
    const response = await request({
      intent: { type: "confirm", ...input },
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source,
      plugin: input.plugin,
      timeout: input.timeout,
    })

    return response.type === "submit"
  }

  export async function select(
    input: Omit<z.input<typeof SelectIntent>, "type"> & {
      sessionID: string
      messageID: string
      callID?: string
      source?: "core" | "plugin"
      plugin?: string
      timeout?: number
    },
  ): Promise<string | undefined> {
    const response = await request({
      intent: { type: "select", ...input },
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source,
      plugin: input.plugin,
      timeout: input.timeout,
    })

    if (response.type === "cancel") {
      return undefined
    }

    return response.data?.selected as string | undefined
  }

  export async function multiselect(
    input: Omit<z.input<typeof MultiSelectIntent>, "type"> & {
      sessionID: string
      messageID: string
      callID?: string
      source?: "core" | "plugin"
      plugin?: string
      timeout?: number
    },
  ): Promise<string[]> {
    const response = await request({
      intent: { type: "multiselect", ...input },
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source,
      plugin: input.plugin,
      timeout: input.timeout,
    })

    if (response.type === "cancel") {
      return []
    }

    return (response.data?.selected as string[]) ?? []
  }

  export async function toast(
    input: Omit<z.input<typeof ToastIntent>, "type"> & {
      sessionID: string
      messageID: string
      callID?: string
      source?: "core" | "plugin"
      plugin?: string
    },
  ): Promise<void> {
    await request({
      intent: { type: "toast", ...input },
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      source: input.source,
      plugin: input.plugin,
    })
  }
}
