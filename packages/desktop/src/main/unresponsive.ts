import type { BrowserWindow } from "electron"
import { write as writeLog } from "./logging"

const sampleInterval = 1000
const samplePeriod = 15000

export function createUnresponsiveSampler(win: BrowserWindow, name: string) {
  let sampleTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let sampling = false
  const samples = new Map<string, number>()

  const active = () => sampling && !win.isDestroyed() && !win.webContents.isDestroyed()
  const clearTimers = () => {
    if (sampleTimer) clearTimeout(sampleTimer)
    if (stopTimer) clearTimeout(stopTimer)
    sampleTimer = undefined
    stopTimer = undefined
  }

  const schedule = () => {
    sampleTimer = setTimeout(() => {
      void collect()
    }, sampleInterval)
  }

  const collect = async () => {
    if (!active()) return
    const stack = await win.webContents.mainFrame.collectJavaScriptCallStack().catch((error) => {
      writeLog("window", "failed to collect unresponsive sample", { window: name, error }, "error")
      return undefined
    })
    if (!active()) return
    if (stack) samples.set(stack, (samples.get(stack) ?? 0) + 1)
    schedule()
  }

  const stopAndFlush = () => {
    const wasSampling = sampling
    sampling = false
    clearTimers()
    if (samples.size === 0) return wasSampling

    const entries = [...samples.entries()].sort((a, b) => b[1] - a[1])
    const total = entries.reduce((sum, entry) => sum + entry[1], 0)
    const message = [
      "renderer unresponsive samples",
      `Window: ${name}`,
      `URL: ${win.isDestroyed() ? "<destroyed>" : win.webContents.getURL()}`,
      ...entries.map((entry) => `<${entry[1]}> ${entry[0]}`),
      `Total Samples: ${total}`,
    ].join("\n")
    writeLog("window", message, undefined, "error")
    samples.clear()
    return wasSampling
  }

  const start = () => {
    if (sampling || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isDevToolsOpened()) return
    sampling = true
    samples.clear()
    schedule()
    stopTimer = setTimeout(stopAndFlush, samplePeriod)
  }

  win.on("closed", stopAndFlush)

  return { start, stopAndFlush }
}
