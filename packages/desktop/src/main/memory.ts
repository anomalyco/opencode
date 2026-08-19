import type { BrowserWindow } from "electron"
import { write as writeLog } from "./logging"
import type { MemoryPressureLevel, ProcessMetric } from "./memory-threshold"
import { peakWorkingSetBytes, pressureLevel } from "./memory-threshold"

export {
  ACTION_BYTES,
  type MemoryPressureLevel,
  type ProcessMetric,
  peakWorkingSetBytes,
  pressureLevel,
  WARNING_BYTES,
} from "./memory-threshold"

const MONITOR_INTERVAL = 30_000

export type MemoryMonitorDeps = {
  // Returns the per-process metrics, mirroring Electron's app.getAppMetrics().
  getAppMetrics: () => ProcessMetric[]
  requestSidecarGc: () => void
  requestRendererGc: () => void
}

export function createMemoryMonitor(deps: MemoryMonitorDeps) {
  let timer: ReturnType<typeof setInterval> | undefined
  let lastLevel: MemoryPressureLevel = "ok"

  const collect = (): MemoryPressureLevel => {
    let metrics: ProcessMetric[]
    try {
      metrics = deps.getAppMetrics()
    } catch (error) {
      writeLog("memory", "failed to read app metrics", { error }, "error")
      return "ok"
    }
    return pressureLevel(peakWorkingSetBytes(metrics))
  }

  const runGc = () => {
    writeLog("memory", "requesting garbage collection")
    ;(globalThis as { gc?: () => void }).gc?.()
    deps.requestSidecarGc()
    deps.requestRendererGc()
  }

  const check = () => {
    const level = collect()
    if (level !== lastLevel) {
      lastLevel = level
      writeLog("memory", "pressure level changed", { level })
    }
    if (level === "action") runGc()
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(check, MONITOR_INTERVAL)
      timer.unref?.()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    },
    // Exposed for diagnostics and tests.
    collect,
    check,
  }
}

export function sendRendererMemoryPressure(windows: Iterable<BrowserWindow>) {
  for (const win of windows) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send("memory-pressure")
  }
}
