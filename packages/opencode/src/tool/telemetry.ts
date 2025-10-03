import path from "path"
import { Log } from "../util/log"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { ToolHistory } from "./history"
import { TelemetryEventSchema, type TelemetryEvent } from "./telemetry-event"
import { Instance } from "../project/instance"

export namespace ToolTelemetry {
  export const Event = {
    Sampled: Bus.event("tool.telemetry", TelemetryEventSchema),
  }
}

const log = Log.create({ service: "tool-telemetry" })

type Context = Tool.Context

export type TelemetryOptions<T = unknown> = {
  id: string
  ctx: Context
  params: unknown
  run(): Promise<T>
  extra?: Record<string, unknown>
  captureInput?: () => unknown
  captureOutput?: (result: T) => unknown
  captureError?: (error: unknown) => unknown
}

function buildEnvironment(ctx: Context) {
  try {
    const project = Instance.project
    const worktree = Instance.worktree
    const directory = Instance.directory
    return {
      projectID: project.id,
      vcs: project.vcs ?? "unknown",
      worktree,
      cwd: directory,
      cwdRelative: path.relative(worktree, directory),
      agent: ctx.agent,
    }
  } catch {
    return undefined
  }
}

function mergeExtra(...parts: Array<Record<string, unknown> | undefined>) {
  const merged: Record<string, unknown> = {}
  for (const part of parts) {
    if (!part) continue
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined) continue
      merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export async function measure<T>(options: TelemetryOptions<T>): Promise<T> {
  const started = Date.now()
  const environment = buildEnvironment(options.ctx)

  const capturedInput = (() => {
    try {
      return options.captureInput?.()
    } catch (error) {
      log.error("failed to capture telemetry input", {
        id: options.id,
        sessionID: options.ctx.sessionID,
        error,
      })
      return undefined
    }
  })()

  try {
    const result = (await options.run()) as T
    const duration = Date.now() - started
    const capturedOutput = (() => {
      try {
        return options.captureOutput?.(result)
      } catch (error) {
        log.error("failed to capture telemetry output", {
          id: options.id,
          sessionID: options.ctx.sessionID,
          error,
        })
        return undefined
      }
    })()

    const base: Omit<TelemetryEvent, "status" | "error"> = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: mergeExtra(
        options.extra,
        capturedInput !== undefined ? { input: capturedInput } : undefined,
        capturedOutput !== undefined ? { output: capturedOutput } : undefined,
        environment ? { environment } : undefined,
      ),
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
    const capturedError = (() => {
      try {
        return options.captureError?.(error)
      } catch (captureError) {
        log.error("failed to capture telemetry error payload", {
          id: options.id,
          sessionID: options.ctx.sessionID,
          captureError,
        })
        return undefined
      }
    })()

    const base: Omit<TelemetryEvent, "status"> = {
      id: options.id,
      sessionID: options.ctx.sessionID,
      callID: options.ctx.callID,
      duration,
      timestamp: Date.now(),
      extra: mergeExtra(
        options.extra,
        capturedInput !== undefined ? { input: capturedInput } : undefined,
        capturedError !== undefined ? { errorPayload: capturedError } : undefined,
        environment ? { environment } : undefined,
      ),
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
