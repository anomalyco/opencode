import type { Page } from "@playwright/test"

export type PromptPosition = { frame: number; top: number | null }

// Records painted compositor frames; the returned stop function reads the prompt position in each frame.
export async function capturePromptMotion(page: Page, view: { x: number; y: number; width: number }) {
  const session = await page.context().newCDPSession(page)
  const frames: { data: string; timestamp?: number }[] = []
  const acknowledgements: Promise<unknown>[] = []

  const onFrame = (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ data: frame.data, timestamp: frame.metadata.timestamp })
    acknowledgements.push(session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }))
  }

  session.on("Page.screencastFrame", onFrame)
  const viewport = page.viewportSize()!
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  })

  return async () => {
    session.off("Page.screencastFrame", onFrame)
    await session.send("Page.stopScreencast")
    await Promise.all(acknowledgements)
    await session.detach()

    // Chromium stamps each frame when it is captured, then JPEG-encodes up to three at once on unsequenced
    // thread-pool tasks and emits each one when its encode finishes, so a slow encode arrives after newer frames.
    const stamped = frames.filter(
      (frame): frame is { data: string; timestamp: number } => frame.timestamp !== undefined,
    )

    if (stamped.length !== frames.length) throw new Error("Screencast frame without a timestamp")

    const ordered = stamped.toSorted((a, b) => a.timestamp - b.timestamp).map((frame) => frame.data)

    return { positions: await readPromptPositions(page, ordered, view), frames: ordered }
  }
}

// Finds the top of the only blue ink (the user prompt) in the top 200px of `view` in each JPEG frame.
export async function readPromptPositions(
  page: Page,
  frames: string[],
  view: { x: number; y: number; width: number },
): Promise<PromptPosition[]> {
  return page.evaluate(
    async ({ frames, view, viewport }) => {
      const positions: PromptPosition[] = []

      for (const [frame, encoded] of frames.entries()) {
        const position: PromptPosition = { frame, top: null }

        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))], { type: "image/jpeg" }),
        )

        const canvas = new OffscreenCanvas(image.width, image.height)
        const context = canvas.getContext("2d")!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        const scale = image.height / viewport.height

        for (let y = Math.ceil(view.y * scale); y < Math.min(image.height, (view.y + 200) * scale); y++) {
          let ink = 0

          for (let x = Math.ceil((view.x + 16) * scale); x < (view.x + view.width - 16) * scale; x++) {
            const offset = (y * image.width + x) * 4

            if (pixels[offset + 2] > pixels[offset] + 50 && pixels[offset + 2] > pixels[offset + 1] + 30) ink++
          }

          if (ink < 3) continue
          position.top = y / scale
          break
        }

        positions.push(position)
        image.close()
      }

      return positions
    },
    { frames, view, viewport: page.viewportSize()! },
  )
}

// After the prompt first paints it must stay painted and never move up by more than 2px.
export function promptMotionIssues(positions: PromptPosition[]) {
  const first = positions.findIndex((position) => position.top !== null)

  if (first < 0) return [{ frame: 0, reason: "never-painted" }]

  return positions.slice(first).flatMap((position, index, all) => {
    if (position.top === null) return [{ frame: position.frame, reason: "missing" }]
    const previous = all[index - 1]?.top

    if (previous === undefined || previous === null || position.top >= previous - 2) return []

    return [{ frame: position.frame, reason: "reversed" }]
  })
}
