import { Log } from "../util/log"
import { Tool } from "./tool"

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
    log.debug("tool executed", {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration: Date.now() - started,
      status: "success",
      extra: options.extra ?? {},
    })
    return result
  } catch (error) {
    log.error("tool failed", {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration: Date.now() - started,
      status: "error",
      extra: options.extra ?? {},
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
