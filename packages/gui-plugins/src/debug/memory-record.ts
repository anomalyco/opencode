import type { ProcessMetric } from "electron"
import { Schema } from "effect"

export const RendererMemory = Schema.Struct({
  jsHeap: Schema.NullOr(Schema.Struct({ used: Schema.Number, total: Schema.Number, limit: Schema.Number })),
  domElements: Schema.Number,
})

export type RendererRecord = {
  id: number
  pid: number
  type: string
  sample?: typeof RendererMemory.Type
  error?: string
}

export function memoryRecord(metrics: ProcessMetric[], renderers: RendererRecord[], preciseJsHeap: boolean) {
  return {
    timestamp: new Date().toISOString(),
    mainPid: process.pid,
    nativeMemoryUnit: "KiB",
    jsHeapUnit: "bytes",
    preciseJsHeap,
    processes: metrics.map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetSize: metric.memory.workingSetSize,
      // Electron exposes privateBytes only on Windows. Null means unavailable, not zero.
      privateBytes: metric.memory.privateBytes ?? null,
    })),
    renderers: renderers.map((renderer) => ({
      ...renderer,
      nativeMemory: metrics.find((metric) => metric.pid === renderer.pid)?.memory ?? null,
    })),
  }
}
