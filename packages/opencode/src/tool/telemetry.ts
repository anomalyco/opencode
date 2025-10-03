import { Log } from "../util/log"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { ToolHistory } from "./history"
import { TelemetryEventSchema, type TelemetryEvent } from "./telemetry-event"

export namespace ToolTelemetry {
  export const Event = {
    Sampled: Bus.event("tool.telemetry", TelemetryEventSchema),
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
    const base: Omit<TelemetryEvent, "status" | "error"> = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: options.extra ?? {},
    }
    log.debug("tool executed", {
      ...base,
      status: "success",
    })
    const successEvent: TelemetryEvent = { ...base, status: "success" }
    await Promise.all([
      Bus.publish(ToolTelemetry.Event.Sampled, successEvent),
      ToolHistory.record(successEvent),
    ])
    return result
  } catch (error) {
    const duration = Date.now() - started
    const base: Omit<TelemetryEvent, "status"> = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: options.extra ?? {},
      error: error instanceof Error ? error.message : String(error),
    }
    log.error("tool failed", {
      ...base,
      status: "error",
    })
    const errorEvent: TelemetryEvent = { ...base, status: "error" }
    await Promise.all([
      Bus.publish(ToolTelemetry.Event.Sampled, errorEvent),
      ToolHistory.record(errorEvent),
    ])
    throw error
  }
}
