import z from "zod/v4"
import { Log } from "../util/log"
import { Tool } from "./tool"
import { Bus } from "../bus"

export namespace ToolTelemetry {
  export const Event = {
    Sampled: Bus.event(
      "tool.telemetry",
      z.object({
        id: z.string(),
        sessionID: z.string(),
        callID: z.string().optional(),
        status: z.enum(["success", "error"]),
        duration: z.number(),
        timestamp: z.number(),
        extra: z.record(z.string(), z.unknown()).optional(),
        error: z.string().optional(),
      }),
    ),
  }
}

const log = Log.create({ service: "tool-telemetry" })

type Context = Tool.Context

export type TelemetryOptions = {
  id: string
  ctx: Context
  params: unknown
  run(): Promise<unknown>
  extra?: Record<string, unknown>
}

export async function measure<T>(options: TelemetryOptions): Promise<T> {
  const started = Date.now()
  try {
    const result = (await options.run()) as T
    const duration = Date.now() - started
    const payload = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: options.extra ?? {},
    }
    log.debug("tool executed", {
      ...payload,
      status: "success",
    })
    await Bus.publish(ToolTelemetry.Event.Sampled, {
      ...payload,
      status: "success",
    })
    return result
  } catch (error) {
    const duration = Date.now() - started
    const payload = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: options.extra ?? {},
      error: error instanceof Error ? error.message : String(error),
    }
    log.error("tool failed", {
      ...payload,
      status: "error",
    })
    await Bus.publish(ToolTelemetry.Event.Sampled, {
      ...payload,
      status: "error",
    })
    throw error
  }
}
