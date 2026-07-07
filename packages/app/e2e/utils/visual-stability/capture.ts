import type { CDPSession, Page } from "@playwright/test"
import type { CapturedFrame } from "./model"

export type VisualCapture = {
  session: CDPSession
  frames: CapturedFrame[]
  startedAtEpoch: number
  running: boolean
  capture: Promise<void>
}

export async function startVisualCapture(page: Page, startedAtEpoch: number) {
  if (process.env.OPENCODE_STABILITY_CAPTURE !== "1") return
  const session = await page.context().newCDPSession(page)
  await session.send("Page.enable")
  const recording: VisualCapture = {
    session,
    frames: [],
    startedAtEpoch,
    running: true,
    capture: Promise.resolve(),
  }
  recording.capture = (async () => {
    try {
      while (recording.running && recording.frames.length < 900) {
        const frame = await session.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 80,
          captureBeyondViewport: false,
          optimizeForSpeed: true,
        })
        recording.frames.push({ at: Date.now() - recording.startedAtEpoch, data: frame.data })
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } catch {
      recording.running = false
    }
  })()
  return recording
}

export async function stopVisualCapture(recording: VisualCapture | undefined) {
  if (!recording) return []
  recording.running = false
  try {
    await recording.capture
  } finally {
    await recording.session.detach().catch(() => undefined)
  }
  return recording.frames
}
