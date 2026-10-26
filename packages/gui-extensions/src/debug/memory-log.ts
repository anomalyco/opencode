import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { app, webContents } from "electron"
import { Schema } from "effect"
import type { Log } from "../sdk/main"
import { memoryRecord, RendererMemory, type RendererRecord } from "./memory-record"

// Runs only while diagnostics are on; no preload hooks, observers, or store subscriptions.
const probe = `(() => {
  const memory = performance.memory;
  return {
    jsHeap: memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null,
    domElements: document.getElementsByTagName('*').length
  };
})()`

/** Appends a sample every `interval` ms to a new JSONL file in the desktop logs, which exported debug logs include. */
export function startMemoryLog(interval: number, log: Log) {
  const file = path.join(
    app.getPath("userData"),
    "logs",
    `memory-${new Date().toISOString().replace(/[:.]/g, "")}.jsonl`,
  )

  // Without the launch switch, Chromium quantizes renderer heap sizes and refreshes them rarely.
  const precise = app.commandLine.hasSwitch("enable-precise-memory-info")
  const pending = new WeakSet<Electron.WebContents>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const sample = async () => {
    const metrics = app.getAppMetrics()

    const renderers = await Promise.all(
      webContents.getAllWebContents().map(async (contents): Promise<RendererRecord> => {
        const identity = { id: contents.id, pid: contents.getOSProcessId(), type: contents.getType() }

        if (pending.has(contents)) return { ...identity, error: "Previous renderer sample is still pending" }
        pending.add(contents)
        let deadline: ReturnType<typeof setTimeout> | undefined
        // A hung renderer must not stop native-memory logging or accumulate evaluation requests.
        const reading = contents.executeJavaScript(probe).then(Schema.decodeUnknownSync(RendererMemory))
        void reading.finally(() => pending.delete(contents)).catch(() => undefined)

        return Promise.race([
          reading,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error("Renderer sample timed out")), 2000)
          }),
        ])
          .then(
            (sample) => ({ ...identity, sample }),
            (error: Error) => ({ ...identity, error: error.message }),
          )
          .finally(() => clearTimeout(deadline))
      }),
    )

    if (stopped) return
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(memoryRecord(metrics, renderers, precise))}\n`, { mode: 0o600 })
  }

  const tick = () => {
    void sample()
      .catch((error: Error) => log.write("error", "memory diagnostics sample failed", { error: error.message }))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, interval)
      })
  }

  log.write("info", "memory diagnostics started", { file, intervalMs: interval, precise })
  timer = setTimeout(tick, interval)

  return () => {
    stopped = true
    clearTimeout(timer)
    log.write("info", "memory diagnostics stopped", { file })
  }
}
