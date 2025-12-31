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

  // ============================================================================
  // Events
  // ============================================================================

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

  // ============================================================================
  // Errors
  // ============================================================================

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

  // ============================================================================
  // State
  // ============================================================================

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
      // On dispose, reject all pending intents
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

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Request user input via intent.
   * Blocks until user responds or cancels.
   * For toast intents, returns immediately (non-blocking).
   */
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

    // Toast intents are non-blocking - just publish and return
    if (input.intent.type === "toast") {
      Bus.publish(Event.Updated, info)
      return { type: "submit" }
    }

    // Initialize session pending map if needed
    const { pending } = state()
    if (!pending[input.sessionID]) {
      pending[input.sessionID] = {}
    }

    return new Promise<z.infer<typeof IntentResponseSchema>>((resolve, reject) => {
      // Store pending intent
      pending[input.sessionID][id] = {
        info,
        resolve,
        reject,
      }

      // Publish event for TUI
      Bus.publish(Event.Updated, info)

      // Optional timeout
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

  /**
   * Submit response to a pending intent.
   * Called by server endpoint when TUI submits.
   */
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

    // Clean up
    delete pending[input.sessionID][input.intentID]
    if (Object.keys(pending[input.sessionID]).length === 0) {
      delete pending[input.sessionID]
    }

    // Publish replied event
    Bus.publish(Event.Replied, {
      sessionID: input.sessionID,
      intentID: input.intentID,
      response: input.response,
    })

    // Resolve or reject based on response type
    if (input.response.type === "cancel") {
      p.reject(
        new CancelledError({
          intentID: input.intentID,
          sessionID: input.sessionID,
        }),
      )
    } else {
      p.resolve(input.response)
    }

    return true
  }

  /**
   * List all pending intents (for a session or all).
   */
  export function list(sessionID?: string): z.infer<typeof IntentInfoSchema>[] {
    const { pending } = state()
    if (sessionID) {
      return Object.values(pending[sessionID] ?? {}).map((p) => p.info)
    }
    return Object.values(pending)
      .flatMap((session) => Object.values(session).map((p) => p.info))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * Cancel all pending intents for a session.
   * Used when session is aborted.
   */
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

  // ============================================================================
  // Convenience Helpers
  // ============================================================================

  /**
   * Show a form and return field values.
   */
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

  /**
   * Show a confirmation dialog and return boolean.
   */
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

  /**
   * Show a select dialog and return selected value.
   */
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

  /**
   * Show a multiselect dialog and return selected values.
   */
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

  /**
   * Show a non-blocking toast notification.
   */
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
