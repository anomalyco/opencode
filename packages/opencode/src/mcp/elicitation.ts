import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js"
import z from "zod"

export namespace Elicitation {
  const log = Log.create({ service: "mcp.elicitation" })

  // Schema definition for a primitive field in the elicitation form
  export const PrimitiveSchema = z.discriminatedUnion("type", [
    // String field
    z.object({
      type: z.literal("string"),
      title: z.string().optional(),
      description: z.string().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      format: z.enum(["email", "uri", "date", "date-time"]).optional(),
      default: z.string().optional(),
      // Single-select enum
      enum: z.array(z.string()).optional(),
      enumNames: z.array(z.string()).optional(), // Legacy support
      // Titled single-select
      oneOf: z
        .array(
          z.object({
            const: z.string(),
            title: z.string(),
          }),
        )
        .optional(),
    }),
    // Number field
    z.object({
      type: z.literal("number"),
      title: z.string().optional(),
      description: z.string().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      default: z.number().optional(),
    }),
    // Integer field
    z.object({
      type: z.literal("integer"),
      title: z.string().optional(),
      description: z.string().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      default: z.number().optional(),
    }),
    // Boolean field
    z.object({
      type: z.literal("boolean"),
      title: z.string().optional(),
      description: z.string().optional(),
      default: z.boolean().optional(),
    }),
    // Multi-select array field
    z.object({
      type: z.literal("array"),
      title: z.string().optional(),
      description: z.string().optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      items: z.object({
        type: z.literal("string").optional(),
        enum: z.array(z.string()).optional(),
        anyOf: z
          .array(
            z.object({
              const: z.string(),
              title: z.string(),
            }),
          )
          .optional(),
      }),
      default: z.array(z.string()).optional(),
    }),
  ])
  export type PrimitiveSchema = z.infer<typeof PrimitiveSchema>

  // Requested schema for form mode
  export const RequestedSchema = z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), PrimitiveSchema),
    required: z.array(z.string()).optional(),
  })
  export type RequestedSchema = z.infer<typeof RequestedSchema>

  // Elicitation request stored in state
  export const Request = z
    .object({
      id: Identifier.schema("elicitation"),
      serverName: z.string(),
      message: z.string(),
      requestedSchema: RequestedSchema,
    })
    .meta({ ref: "ElicitationRequest" })
  export type Request = z.infer<typeof Request>

  // Content submitted by user
  export const Content = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
  export type Content = z.infer<typeof Content>

  // Bus events
  export const Event = {
    Requested: BusEvent.define("mcp.elicitation.requested", Request),
    Completed: BusEvent.define(
      "mcp.elicitation.completed",
      z.object({
        id: z.string(),
        serverName: z.string(),
        action: z.enum(["accept", "decline", "cancel"]),
        content: Content.optional(),
      }),
    ),
    Rejected: BusEvent.define(
      "mcp.elicitation.rejected",
      z.object({
        id: z.string(),
        serverName: z.string(),
        action: z.enum(["decline", "cancel"]),
      }),
    ),
  }

  // State for pending elicitation requests
  const state = Instance.state(async () => {
    const pending: Record<
      string,
      {
        info: Request
        resolve: (result: ElicitResult) => void
        reject: (e: Error) => void
      }
    > = {}

    return {
      pending,
    }
  })

  /**
   * Handle an incoming elicitation request from an MCP server.
   * Returns a Promise that resolves when the user responds.
   */
  export async function handle(
    serverName: string,
    request: ElicitRequest,
    signal?: AbortSignal,
  ): Promise<ElicitResult> {
    const s = await state()
    const id = Identifier.ascending("elicitation")
    const params = request.params

    log.info("elicitation request received", {
      id,
      serverName,
      message: params.message,
    })

    if (!("requestedSchema" in params)) {
      throw new Error("Only form mode elicitations are supported")
    }

    const schemaResult = RequestedSchema.safeParse(params.requestedSchema)
    if (!schemaResult.success) {
      log.warn("invalid elicitation schema", { error: schemaResult.error })
      throw new Error("Invalid elicitation schema: " + schemaResult.error.message)
    }

    const info: Request = {
      id,
      serverName,
      message: params.message,
      requestedSchema: schemaResult.data,
    }

    return new Promise<ElicitResult>((resolve, reject) => {
      s.pending[id] = { info, resolve, reject }
      Bus.publish(Event.Requested, info)

      // Clean up if the request is aborted (e.g., timeout)
      if (signal) {
        const onAbort = () => {
          log.info("elicitation aborted", { id })
          delete s.pending[id]
          Bus.publish(Event.Rejected, {
            id,
            serverName,
            action: "cancel",
          })
        }
        signal.addEventListener("abort", onAbort, { once: true })
      }
    })
  }

  /**
   * Submit user's response to an elicitation (accept with content).
   */
  export async function reply(id: string, content: Content): Promise<boolean> {
    const s = await state()
    const existing = s.pending[id]
    if (!existing) {
      log.warn("reply for unknown elicitation", { id })
      return false
    }
    delete s.pending[id]

    log.info("elicitation replied", { id, content })

    Bus.publish(Event.Completed, {
      id,
      serverName: existing.info.serverName,
      action: "accept",
      content,
    })

    existing.resolve({
      action: "accept",
      content,
    })
    return true
  }

  /**
   * Reject/decline/cancel an elicitation.
   */
  export async function reject(id: string, action: "decline" | "cancel" = "cancel"): Promise<boolean> {
    const s = await state()
    const existing = s.pending[id]
    if (!existing) {
      log.warn("reject for unknown elicitation", { id })
      return false
    }
    delete s.pending[id]

    log.info("elicitation rejected", { id, action })

    Bus.publish(Event.Rejected, {
      id,
      serverName: existing.info.serverName,
      action,
    })

    existing.resolve({
      action,
    })
    return true
  }

  /**
   * List all pending elicitations.
   */
  export async function list(): Promise<Request[]> {
    const s = await state()
    return Object.values(s.pending).map((x) => x.info)
  }

  /**
   * Get a specific pending elicitation.
   */
  export async function get(id: string): Promise<Request | undefined> {
    const s = await state()
    return s.pending[id]?.info
  }

  /**
   * Cancel an elicitation (e.g., when the MCP request times out).
   * This removes it from pending state and notifies the UI.
   */
  export async function cancel(id: string): Promise<void> {
    const s = await state()
    const existing = s.pending[id]
    if (!existing) {
      return // Already cleaned up
    }
    delete s.pending[id]

    log.info("elicitation cancelled", { id })

    Bus.publish(Event.Rejected, {
      id,
      serverName: existing.info.serverName,
      action: "cancel",
    })
  }

  /**
   * Cancel all pending elicitations for a server (e.g., when server disconnects).
   */
  export async function cancelAllForServer(serverName: string): Promise<void> {
    const s = await state()
    for (const [id, entry] of Object.entries(s.pending)) {
      if (entry.info.serverName === serverName) {
        delete s.pending[id]
        log.info("elicitation cancelled (server)", { id, serverName })
        Bus.publish(Event.Rejected, {
          id,
          serverName,
          action: "cancel",
        })
      }
    }
  }

  export class RejectedError extends Error {
    constructor(action: "decline" | "cancel") {
      super(`User ${action === "decline" ? "declined" : "cancelled"} the elicitation`)
    }
  }
}
