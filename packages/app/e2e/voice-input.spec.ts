import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture } from "./performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./performance/timeline/timeline-test-helpers"

// Exercise Chromium's actual MediaRecorder and Web Audio with a synthetic device.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } })

type Capture = { streams: MediaStream[]; release?: () => void }

async function trackCapture(page: Page, pending = false) {
  await page.addInitScript((pending) => {
    const capture: Capture = { streams: [] }
    Object.assign(window, { voiceTest: capture })
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints)
      capture.streams.push(stream)
      if (!pending) return stream
      return new Promise<MediaStream>((resolve) => {
        capture.release = () => resolve(stream)
      })
    }
  }, pending)
}

async function openSession(page: Page, v2: boolean) {
  await mockStressTimeline(page)
  if (v2) await installTimelineSettings(page)
  else {
    // The legacy UI retired in September; exercise its recorder before that cutoff.
    await page.clock.setFixedTime(new Date("2026-09-01T12:00:00Z"))
    await page.addInitScript(() => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: false, layoutTransitionEligible: true } }),
      )
      localStorage.setItem("app-version.v1", JSON.stringify({ version: "1.18.34" }))
    })
  }
  await installStressSessionTabs(page)
  await page.goto(
    v2 ? stressSessionHref(fixture.sourceID) : `/${base64Encode(fixture.directory)}/session/${fixture.sourceID}`,
  )
  await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
  await expect(page.locator('form[data-component="prompt-input-v2"]')).toHaveCount(v2 ? 1 : 0)
}

async function stoppedTracks(page: Page) {
  return page.evaluate(() => {
    const capture = (window as unknown as { voiceTest: Capture }).voiceTest
    return (
      capture.streams.length > 0 &&
      capture.streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))
    )
  })
}

for (const v2 of [false, true]) {
  test.describe(v2 ? "v2 voice input" : "legacy voice input", () => {
    test("records real audio, shows input amplitude, stops, previews and discards without changing the draft", async ({
      page,
    }) => {
      await trackCapture(page)
      await openSession(page, v2)
      const editor = v2
        ? page.getByRole("textbox", { name: "Prompt" })
        : page.locator('[data-component="prompt-input"]')
      await editor.fill("Keep this draft.")
      await page.getByRole("button", { name: "Record audio", exact: true }).click()
      await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled()
      await expect(editor).toHaveAttribute("contenteditable", "false")
      await expect
        .poll(() =>
          page.getByRole("img", { name: "Microphone input volume" }).evaluate((element) => {
            const canvas = element as HTMLCanvasElement
            const context = canvas.getContext("2d")!
            const pixels = context.getImageData(0, 0, canvas.width, Math.max(1, Math.floor(canvas.height / 4))).data
            return pixels.some((value, index) => index % 4 === 3 && value > 0)
          }),
        )
        .toBe(true)
      await expect(page.getByRole("timer")).not.toHaveText("0:00")
      await page.screenshot({ path: test.info().outputPath(`voice-${v2 ? "v2" : "legacy"}-recording.png`) })
      await page.getByRole("button", { name: "Stop recording", exact: true }).click()
      await expect(page.getByRole("button", { name: "Play recording", exact: true })).toBeEnabled()
      await expect.poll(() => stoppedTracks(page)).toBe(true)
      await page.getByRole("button", { name: "Play recording", exact: true }).click()
      await expect(page.getByRole("button", { name: "Pause playback", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Pause playback", exact: true }).click()
      await expect(page.getByRole("button", { name: "Play recording", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Discard recording", exact: true }).click()
      await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
      await expect(editor).toHaveAttribute("contenteditable", "true")
      await expect(editor).toHaveText("Keep this draft.")
    })

    test("keeps the arrow beside stop and preserves audio when no voice model is selected", async ({ page }) => {
      await trackCapture(page)
      await openSession(page, v2)
      await page.getByRole("button", { name: "Record audio", exact: true }).click()
      const stop = page.getByRole("button", { name: "Stop recording", exact: true })
      const arrow = page.locator('[data-action="prompt-submit"]')
      await expect(stop).toBeEnabled()
      await expect(arrow).toBeEnabled()
      const stopBox = await stop.boundingBox()
      const arrowBox = await arrow.boundingBox()
      expect(arrowBox!.x).toBeGreaterThan(stopBox!.x + stopBox!.width)
      await expect(page.getByRole("timer")).not.toHaveText("0:00")
      await arrow.click()
      await expect(page.getByRole("button", { name: "Play recording", exact: true })).toBeEnabled()
      await expect.poll(() => stoppedTracks(page)).toBe(true)
      await expect(
        page.getByText("Select an available voice model in Settings → Models → Voice.", { exact: true }),
      ).toBeVisible()
      await page.getByRole("button", { name: "Discard recording", exact: true }).click()
    })

    test("cancels while recording and releases the microphone on Escape", async ({ page }) => {
      await trackCapture(page)
      await openSession(page, v2)
      await page.getByRole("button", { name: "Record audio", exact: true }).click()
      await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
      await expect.poll(() => stoppedTracks(page)).toBe(true)
    })

    test("discards a microphone request that resolves after cancellation", async ({ page }) => {
      await trackCapture(page, true)
      await openSession(page, v2)
      await page.getByRole("button", { name: "Record audio", exact: true }).click()
      await expect(page.locator('[data-component="voice-input"]').getByRole("status")).toHaveText(
        "Waiting for microphone access",
      )
      await expect
        .poll(() => page.evaluate(() => !!(window as unknown as { voiceTest: Capture }).voiceTest.release))
        .toBe(true)
      await page.getByRole("button", { name: "Discard recording", exact: true }).click()
      await page.evaluate(() => (window as unknown as { voiceTest: Capture }).voiceTest.release!())
      await expect.poll(() => stoppedTracks(page)).toBe(true)
      await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
      await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toHaveCount(0)
    })
  })
}

test("recovers from a microphone permission error through the retry action", async ({ page }) => {
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = () => {
      navigator.mediaDevices.getUserMedia = capture
      return Promise.reject(new DOMException("Denied", "NotAllowedError"))
    }
  })
  await openSession(page, true)
  await page.getByRole("button", { name: "Record audio", exact: true }).click()
  await expect(page.getByText("Microphone access needed", { exact: true })).toBeVisible()
  await expect(page.getByText(/Open the site controls beside the address bar/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Open microphone settings", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled()
  await expect(page.getByText("Microphone access needed", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Discard recording", exact: true }).click()
})

for (const error of [
  { name: "NotFoundError", message: "No available microphone was found." },
  { name: "NotReadableError", message: "The microphone could not be opened." },
  { name: "SecurityError", message: "Microphone access is disabled in this environment." },
]) {
  test(`gives a specific recovery message for ${error.name}`, async ({ page }) => {
    await page.addInitScript((name) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Capture failed", name))
    }, error.name)
    await openSession(page, true)
    await page.getByRole("button", { name: "Record audio", exact: true }).click()
    await expect(page.getByText(error.message, { exact: false })).toBeVisible()
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled()
  })
}

test("releases the microphone when navigating to another session", async ({ page }) => {
  await trackCapture(page)
  await openSession(page, true)
  await page.getByRole("button", { name: "Record audio", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled()
  await page.locator(`[href="${stressSessionHref(fixture.targetID)}"]`).click()
  await expect.poll(() => stoppedTracks(page)).toBe(true)
  await expect(page.getByRole("button", { name: "Record audio", exact: true })).toBeEnabled()
})
