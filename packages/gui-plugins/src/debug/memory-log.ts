import { mkdir } from "node:fs/promises"
import path from "node:path"
import { app, webContents } from "electron"
import { Schema } from "effect"
import { memoryRecord, RendererMemory, type RendererRecord } from "./memory-record"

const RENDERER_PROBE_TIMEOUT_MS = 2_000

// Runs only while diagnostics are on; no preload hooks, observers, or store subscriptions.
const probe = `(() => {
  const memory = performance.memory;
  return {
    jsHeap: memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null,
    domElements: document.getElementsByTagName('*').length
  };
})()`

/** A new JSONL file in the desktop logs, which exported debug logs include. */
export function memoryLogFile() {
  return path.join(app.getPath("userData"), "logs", `memory-${new Date().toISOString().replace(/[:.]/g, "")}.jsonl`)
}

/**
 * Collects one sample line for `file`, creating its folder, so appending it is the only step left. A renderer whose
 * earlier probe has not settled is skipped, and a probe that takes too long is reported without waiting for it.
 */
export async function collectMemorySample(
  file: string,
  precise: boolean,
  probes: {
    readonly pending: (contentsId: number) => boolean
    readonly started: (contentsId: number) => void
    readonly settled: (contentsId: number) => void
  },
) {
  const metrics = app.getAppMetrics()

  const renderers = await Promise.all(
    webContents.getAllWebContents().map(async (contents): Promise<RendererRecord> => {
      const identity = { id: contents.id, pid: contents.getOSProcessId(), type: contents.getType() }

      if (probes.pending(contents.id)) return { ...identity, error: "Previous renderer sample is still pending" }
      probes.started(contents.id)
      let deadline: ReturnType<typeof setTimeout> | undefined
      const reading = contents.executeJavaScript(probe).then(Schema.decodeUnknownSync(RendererMemory))
      void reading.finally(() => probes.settled(contents.id)).catch(() => undefined)

      return Promise.race([
        reading,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Renderer sample timed out")), RENDERER_PROBE_TIMEOUT_MS)
        }),
      ])
        .then(
          (sample) => ({ ...identity, sample }),
          (error: Error) => ({ ...identity, error: error.message }),
        )
        .finally(() => clearTimeout(deadline))
    }),
  )

  await mkdir(path.dirname(file), { recursive: true })

  return `${JSON.stringify(memoryRecord(metrics, renderers, precise))}\n`
}
