import type { BrowserWindow } from "electron"
import { write as writeLog } from "./logging"

const samplePeriod = 15000

export function createUnresponsiveSampler(win: BrowserWindow, name: string) {
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let sampling = false
  const samples = new Map<string, number>()

  const active = () => sampling && !win.isDestroyed() && !win.webContents.isDestroyed()

  const stopAndFlush = () => {
    const wasSampling = sampling
    sampling = false
    if (stopTimer) clearTimeout(stopTimer)
    stopTimer = undefined
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

    void win.webContents.mainFrame.collectJavaScriptCallStack().then((stack) => {
      if (!active()) return
      if (stack) samples.set(stack, (samples.get(stack) ?? 0) + 1)
    }).catch((error) => {
      writeLog("window", "failed to collect unresponsive sample", { window: name, error }, "error")
    })

    stopTimer = setTimeout(stopAndFlush, samplePeriod)
  }

  win.on("closed", stopAndFlush)

  return { start, stopAndFlush }
}
