import path from "path"
import { Instance } from "../project/instance"

export namespace TrajectoryConfig {
  export interface Options {
    enabled: boolean
    outputPath: string
    filenameTemplate: string
    bufferSize: number
    flushStrategy: "immediate" | "end_of_stream" | "buffered"
    captureStreamEvents: boolean
  }

  const DEFAULTS: Options = {
    enabled: true,
    outputPath: ".opencode/trajectories",
    filenameTemplate: "trajectory_{sessionID}_{timestamp}.jsonl",
    bufferSize: 1000,
    flushStrategy: "end_of_stream",
    captureStreamEvents: true,
  }

  export function get(): Options {
    return { ...DEFAULTS }
  }

  export function set(options: Partial<Options>): void {
    // No-op: configuration is now static defaults only
  }

  export function resolveFilename(
    sessionID: string,
    context: {
      agent: string
      model: string
      timestamp: number
    },
  ): string {
    const safeModel = context.model.replace(/[\\/]/g, "-")
    const template = get().filenameTemplate
    return template
      .replaceAll("{sessionID}", sessionID)
      .replaceAll("{agent}", context.agent)
      .replaceAll("{model}", safeModel)
      .replaceAll("{timestamp}", String(context.timestamp))
  }
}
