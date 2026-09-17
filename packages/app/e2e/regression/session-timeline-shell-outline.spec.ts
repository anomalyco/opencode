import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  shell,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

for (const deviceScaleFactor of [1.25, 1.5]) {
  test(`keeps the shell outline inside a fractionally short virtual row at ${deviceScaleFactor}x`, async ({ page }) => {
    const shellID = "prt_shell_outline"
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([shell(shellID, "completed", "shell output")])],
      settings: { newLayoutDesigns: true, shellToolPartsExpanded: true },
      reducedMotion: true,
      deviceScaleFactor,
    })
    const part = page.locator(`[data-timeline-part-id="${shellID}"]`)
    const output = part.locator('[data-component="bash-output"]')
    const row = page.locator("[data-timeline-key]", { has: part })
    await expect(output).toBeVisible()
    await timeline.settle()

    const geometry = await row.evaluate((element) => {
      const output = element.querySelector<HTMLElement>('[data-component="bash-output"]')
      if (!output) throw new Error("Shell output is unavailable")
      const rowRect = element.getBoundingClientRect()
      const outputRect = output.getBoundingClientRect()
      // Match a rounded-down measurement at a fractional device-pixel phase.
      element.style.height = `${outputRect.bottom - rowRect.top - 0.49}px`
      element.style.transform = "translateY(0.25px)"
      output.style.setProperty("--v2-border-border-base", "rgb(255, 0, 255)")
      output.style.setProperty("background", "rgb(0, 0, 0)", "important")
      const style = getComputedStyle(output)
      return {
        outputWidth: outputRect.width,
        outputHeight: outputRect.height,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow,
        clipMargin: getComputedStyle(element).overflowClipMargin,
      }
    })
    await timeline.settle()

    const clipped = await row.evaluate((element) => {
      const output = element.querySelector<HTMLElement>('[data-component="bash-output"]')!
      return output.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom
    })
    expect(clipped).toBeCloseTo(0.49, 1)

    expect(await page.evaluate(() => devicePixelRatio)).toBe(deviceScaleFactor)
    const edges = await captureCardEdges(page, output)

    expect(edges.box.width).toBeCloseTo(geometry.outputWidth, 2)
    expect(edges.box.height).toBeCloseTo(geometry.outputHeight, 2)
    expect(geometry.borderColor).toBe("rgb(255, 0, 255)")
    expect(geometry.boxShadow).toBe("none")
    expect(geometry.clipMargin).toBe("0.5px")
    expect(edges.magenta.top).toBeGreaterThan(0.75)
    expect(edges.magenta.bottom).toBeGreaterThan(0.75)
    expect(edges.magenta.vertical).toBeGreaterThanOrEqual(2)
  })
}

test("keeps the patch card inside a fractionally short virtual row", async ({ page }) => {
  const patchID = "prt_patch_outline"
  const file = {
    filePath: "src/outline.ts",
    relativePath: "src/outline.ts",
    type: "update",
    additions: 1,
    deletions: 1,
    before: "const outline = false\n",
    after: "const outline = true\n",
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(patchID, "apply_patch", "completed", { files: [file.filePath] }, { metadata: { files: [file] } }),
      ]),
    ],
    settings: { editToolPartsExpanded: true, newLayoutDesigns: true },
    reducedMotion: true,
  })
  const part = page.locator(`[data-timeline-part-id="${patchID}"]`)
  const card = part.locator('[data-component="accordion"][data-scope="apply-patch"]')
  const row = page.locator("[data-timeline-key]", { has: part })
  await expect(card).toBeVisible()
  await timeline.settle()

  const geometry = await row.evaluate((element) => {
    const card = element.querySelector<HTMLElement>('[data-component="accordion"][data-scope="apply-patch"]')
    if (!card) throw new Error("Patch card is unavailable")
    const rowRect = element.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    element.style.height = `${cardRect.bottom - rowRect.top - 0.49}px`
    const clipMargin = getComputedStyle(element).overflowClipMargin
    const bottom = element.getBoundingClientRect().bottom
    return {
      overflow: card.getBoundingClientRect().bottom - bottom,
      paintOverflow: card.getBoundingClientRect().bottom - bottom - Number.parseFloat(clipMargin),
      clipMargin,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
    }
  })
  await timeline.settle()

  expect(geometry.overflow).toBeCloseTo(0.49, 1)
  expect(geometry.paintOverflow).toBeLessThanOrEqual(0)
  const edges = await captureCardEdges(page, card)
  expect(edges.box.width).toBeCloseTo(geometry.cardWidth, 2)
  expect(edges.box.height).toBeCloseTo(geometry.cardHeight, 2)
  expect(edges.luminance.top).toBeLessThan(245)
  expect(edges.luminance.bottom).toBeLessThan(245)
  expect(Math.abs(edges.luminance.bottom - edges.luminance.top)).toBeLessThan(10)
  expect(geometry.clipMargin).toBe("0.5px")
})

test("allows paint rounding for every framed row but not fixed turn gaps", async ({ page }) => {
  const secondUserID = "msg_outline_second_user"
  await setupTimeline(page, {
    messages: [
      userMessage(undefined, {
        summary: {
          diffs: [
            {
              file: "src/summary.ts",
              additions: 1,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-export const value = 1\n+export const value = 2",
            },
          ],
        },
      }),
      assistantMessage([textPart("prt_outline_text", "Assistant text")]),
      userMessage(undefined, { id: secondUserID, created: 1700000010000 }),
      assistantMessage([], {
        id: "msg_outline_second_assistant",
        parentID: secondUserID,
        created: 1700000011000,
      }),
    ],
  })
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()

  const rows = await page.locator("[data-timeline-key]").evaluateAll((elements) =>
    elements.map((element) => ({
      tag: element.querySelector<HTMLElement>("[data-timeline-row]")?.dataset.timelineRow,
      clipMargin: getComputedStyle(element).overflowClipMargin,
    })),
  )
  expect(rows.filter((row) => row.tag !== "TurnGap").every((row) => row.clipMargin === "0.5px")).toBe(true)
  expect(rows.filter((row) => row.tag === "TurnGap")).toEqual([{ tag: "TurnGap", clipMargin: "0px" }])
})

async function captureCardEdges(page: Page, card: Locator) {
  const box = await card.boundingBox()
  if (!box) throw new Error("Tool card bounds are unavailable")
  const viewport = page.viewportSize()
  if (!viewport) throw new Error("Viewport bounds are unavailable")
  const screenshot = await page.screenshot()
  return page.evaluate(
    async ({ source, box, viewport }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("2D canvas is unavailable")
      context.drawImage(image, 0, 0)
      const scale = {
        x: image.naturalWidth / viewport.width,
        y: image.naturalHeight / viewport.height,
      }
      const rows = (candidates: number[]) => {
        const left = Math.floor((box.x + 8) * scale.x)
        const width = Math.floor((box.width - 16) * scale.x)
        return candidates.map((row) => {
          const pixels = context.getImageData(left, row, width, 1).data
          const indexes = Array.from({ length: width }, (_, index) => index * 4)
          return {
            luminance:
              indexes
                .map((index) => (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3)
                .reduce((sum, value) => sum + value, 0) / width,
            magenta:
              indexes.filter((index) => pixels[index]! > 200 && pixels[index + 1]! < 180 && pixels[index + 2]! > 200)
                .length / width,
          }
        })
      }
      const pixels = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data
      const columns = new Uint32Array(image.naturalWidth)
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index]! <= 200 || pixels[index + 1]! >= 180 || pixels[index + 2]! <= 200) continue
        columns[(index / 4) % image.naturalWidth] = columns[(index / 4) % image.naturalWidth]! + 1
      }
      const top = box.y * scale.y
      const bottom = (box.y + box.height) * scale.y
      const topRows = rows([Math.floor(top) - 1, Math.floor(top), Math.ceil(top)])
      const bottomRows = rows([Math.floor(bottom) - 2, Math.floor(bottom) - 1, Math.ceil(bottom) - 1])
      return {
        box,
        luminance: {
          top: Math.min(...topRows.map((row) => row.luminance)),
          bottom: rows([Math.ceil(bottom) - 1])[0]!.luminance,
        },
        magenta: {
          top: Math.max(...topRows.map((row) => row.magenta)),
          bottom: Math.max(...bottomRows.map((row) => row.magenta)),
          vertical: Array.from(columns).filter((count) => count > box.height * scale.y * 0.75).length,
        },
      }
    },
    {
      source: `data:image/png;base64,${screenshot.toString("base64")}`,
      viewport,
      box,
    },
  )
}
