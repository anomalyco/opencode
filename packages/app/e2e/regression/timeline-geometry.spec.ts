import { expect, test, type Locator, type Page } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import {
  assistantMessage,
  partUpdated,
  renderedPartID,
  sessionID,
  setupTimeline,
  shell,
  textPart,
  toolPart,
  userMessage,
  userText,
  waitForVisualSettle,
} from "../utils/timeline"
import {
  analyzeVisualObservations,
  defineVisualRegions,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../utils/visual-stability"

const expanded = { editToolPartsExpanded: true, shellToolPartsExpanded: true, showReasoningSummaries: true }

const contextTools = [
  { id: "ctx_0100_read", tool: "read", input: { path: "src/recent-a.ts", offset: 0, limit: 120 } },
  { id: "ctx_0101_glob", tool: "glob", input: { path: "C:/OpenCode/TimelineStability", pattern: "**/*.ts" } },
  {
    id: "ctx_0102_grep",
    tool: "grep",
    input: { path: "C:/OpenCode/TimelineStability", pattern: "Explored", include: "*.ts" },
  },
  { id: "ctx_0103_list", tool: "list", input: { path: "src" } },
]

const contextSelector = `[data-timeline-part-ids="${contextTools.map((tool) => tool.id).join(",")}"]`

const output = (tool: string) => `Completed ${tool}.\n${"detail line\n".repeat(8)}`

function contextTurn(status: "running" | "completed") {
  return [
    userMessage(),
    assistantMessage([
      ...contextTools.map((tool) =>
        status === "running"
          ? toolPart(tool.id, tool.tool, "running", tool.input)
          : toolPart(tool.id, tool.tool, "completed", tool.input, { output: output(tool.tool) }),
      ),
      textPart("prt_after_context", "This assistant text is immediately after the explored context group."),
    ]),
  ]
}

test("remeasures a recent explored context group before the next paint", async ({ page }) => {
  await setupTimeline(page, { seedHistory: true, settings: expanded, messages: contextTurn("completed") })
  const following = `[data-timeline-part-id="${renderedPartID("prt_after_context")}"]`
  await expect(page.locator(contextSelector)).toBeVisible()
  await expect(page.locator(following)).toBeVisible()
  await waitForVisualSettle(page, [contextSelector, following])

  // Samples every painted frame after the click until the open group's row holds its measured content, so a
  // stale row height shows up as overlap before the virtualizer catches up.
  const samples = await page.evaluate(
    ({ contextSelector, following }) =>
      new Promise<{ frame: number; overlap: number; expanded: string | null; measured: boolean }[]>((resolve) => {
        const context = document.querySelector<HTMLElement>(contextSelector)
        const text = document.querySelector<HTMLElement>(following)
        const scroller = context?.closest<HTMLElement>(".scroll-view__viewport")
        const trigger = context?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')
        const contextRow = context?.closest<HTMLElement>('[data-timeline-row="AssistantPart"]')
        const virtualRow = context?.closest<HTMLElement>("[data-timeline-key]")
        const textRow = text?.closest<HTMLElement>('[data-timeline-row="AssistantPart"]')

        if (!scroller || !trigger || !contextRow || !virtualRow || !textRow) throw new Error("missing regression nodes")
        scroller.scrollTop = scroller.scrollHeight
        const samples: { frame: number; overlap: number; expanded: string | null; measured: boolean }[] = []

        const capture = (frame: number) => {
          const content = context!.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
          const allocated = virtualRow.getBoundingClientRect().height
          const inner = virtualRow.firstElementChild?.getBoundingClientRect().height ?? Infinity
          samples.push({
            frame,
            overlap: Math.max(
              0,
              Math.round((contextRow.getBoundingClientRect().bottom - textRow.getBoundingClientRect().top) * 10) / 10,
            ),
            expanded: trigger.getAttribute("aria-expanded"),
            measured:
              !!content &&
              Math.abs(content.getBoundingClientRect().height - content.scrollHeight) <= 1 &&
              Math.abs(allocated - inner) <= 1,
          })
        }

        capture(-1)
        trigger.click()
        capture(0)

        const tick = (frame: number) =>
          setTimeout(() => {
            capture(frame)
            const last = samples.at(-1)!

            if (last.expanded === "true" && last.measured) return resolve(samples)
            requestAnimationFrame(() => tick(frame + 1))
          }, 0)

        requestAnimationFrame(() => tick(1))
      }),
    { contextSelector, following },
  )

  expect(samples[0]?.overlap).toBe(0)
  expect(samples.filter((sample) => sample.frame >= 1 && sample.overlap > 0.5)).toEqual([])
  expect(samples.at(-1)).toMatchObject({ expanded: "true", measured: true })
})

test("keeps a grouped tool summary stable as its calls complete", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    seedHistory: true,
    settings: expanded,
    messages: contextTurn("running"),
    cpuRate: 4,
  })

  const context = page.locator(contextSelector)
  const label = "1 read, 3 tools"
  const trigger = context.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAccessibleName(label)
  // Open the group so each call shows whether it is still running.
  await trigger.click()

  const status = (tool: string) =>
    context.locator(
      `[data-slot="context-tool-group-item"] [data-component="text-shimmer"][aria-label="${tool[0]!.toUpperCase()}${tool.slice(1)}"]`,
    )

  for (const tool of contextTools) await expect(status(tool.tool)).toHaveAttribute("data-active", "true")
  const following = `[data-timeline-part-id="${renderedPartID("prt_after_context")}"]`
  await waitForVisualSettle(page, [contextSelector, following])

  const regions = defineVisualRegions({
    status: { selector: `${contextSelector} [data-component="context-tool-group-trigger"]` },
    context: { selector: contextSelector, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: following, closest: '[data-timeline-row="AssistantPart"]' },
  })

  await startVisualProbe(page, regions)

  // Each completion lands in its own settled frame so the probe sees every intermediate state.
  for (const tool of contextTools) {
    await timeline.send(
      partUpdated(toolPart(tool.id, tool.tool, "completed", tool.input, { output: output(tool.tool) })),
    )
    await expect(status(tool.tool)).toHaveAttribute("data-active", "false")
    await waitForVisualSettle(page, [contextSelector, following])
  }

  for (const tool of contextTools) await expect(status(tool.tool)).toHaveAttribute("data-active", "false")
  await expect(trigger).toHaveAccessibleName(label)
  const trace = await stopVisualProbe<keyof typeof regions>(page)

  const labels = trace.samples
    .map((sample) => sample.regions.status?.label)
    .filter((value): value is string => !!value)
    .filter((value, index, all) => value !== all[index - 1])

  const issues = analyzeVisualObservations(
    trace.samples,
    visualPlan(regions, [
      { type: "required", regions: ["context", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all" },
      { type: "label-stability", regions: "all" },
      { type: "flow", regions: ["context", "following"] },
    ]),
  )

  expect(labels).toEqual([label])
  expect(issues, JSON.stringify(trace.samples, null, 2)).toEqual([])
})

test("keeps a file diff anchored while it expands and collapses", async ({ page }) => {
  const id = "prt_file_projection_anchored_patch"
  const before = Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}\n`).join("")
  const after = before.replaceAll(" = ", " = compute(").replaceAll("\n", ")\n")
  await setupTimeline(page, {
    settings: {
      timelineDetail: { ...timelinePresets[2].value, edit: { placement: "separate", details: "collapsed" } },
    },
    messages: [
      userMessage([userText("Preceding context ".repeat(120))]),
      assistantMessage([
        toolPart(
          id,
          "patch",
          "completed",
          { patchText: "Update src/anchored.ts" },
          {
            metadata: {
              files: [
                {
                  file: "src/anchored.ts",
                  status: "modified",
                  patch: createTwoFilesPatch("a/src/anchored.ts", "b/src/anchored.ts", before, after),
                  additions: 80,
                  deletions: 80,
                },
              ],
            },
          },
        ),
      ]),
    ],
    viewport: { width: 1200, height: 600 },
  })

  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const wrapper = page.locator(`[data-timeline-part-id="${id}"]`)
  const diff = wrapper.locator('[data-component="apply-patch-file-diff"]')
  const row = page.locator("[data-timeline-key]", { has: wrapper })
  const trigger = wrapper.getByRole("button")

  const bottom = () =>
    scroller.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))

  const measured = () =>
    row.evaluate((element) => {
      const content = element.querySelector<HTMLElement>("[data-index]")

      return content
        ? Math.abs(element.getBoundingClientRect().height - content.getBoundingClientRect().height)
        : Number.POSITIVE_INFINITY
    })

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect.poll(measured).toBeLessThanOrEqual(1)

  // Pinned to the tail, toggling the diff keeps the view at the bottom.
  for (const visible of [true, false]) {
    await trigger.click()
    await expect(diff).toHaveCount(visible ? 1 : 0)
    await expect.poll(bottom).toBeLessThanOrEqual(1)
  }

  // Scrolled away from the tail, the header keeps its viewport position.
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(1)
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 0.25
  })
  await expect(trigger).toBeInViewport()
  await expect.poll(bottom).toBeLessThanOrEqual(0.5)
  const bottomScrollTop = await scroller.evaluate((element) => element.scrollTop)
  await scroller.hover()
  await page.mouse.wheel(0, -20)
  await expect
    .poll(() => scroller.evaluate((element, bottom) => bottom - element.scrollTop, bottomScrollTop))
    .toBeGreaterThan(0)
  const y = await trigger.evaluate((element) => element.getBoundingClientRect().y)
  const collapsedHeight = await row.evaluate((element) => element.getBoundingClientRect().height)
  await trigger.click()
  await expect(diff).toBeVisible()
  await expect
    .poll(() =>
      row.evaluate((element, collapsed) => {
        const content = element.querySelector<HTMLElement>("[data-index]")
        const allocated = element.getBoundingClientRect().height

        return {
          grew: allocated > collapsed + 1,
          measured: content ? Math.abs(allocated - content.getBoundingClientRect().height) <= 1 : false,
        }
      }, collapsedHeight),
    )
    .toEqual({ grew: true, measured: true })
  await expect
    .poll(() => trigger.evaluate((element, initialY) => Math.abs(element.getBoundingClientRect().y - initialY), y))
    .toBeLessThanOrEqual(5)

  const scrollTop = await scroller.evaluate((element) => element.scrollTop)
  await scroller.hover()
  await page.mouse.wheel(0, 200)
  await expect
    .poll(() => scroller.evaluate((element, initial) => element.scrollTop - initial, scrollTop))
    .toBeGreaterThan(50)
  expect(await scroller.evaluate((element, initial) => element.scrollTop - initial, scrollTop)).toBeLessThan(400)

  const expandedY = await trigger.evaluate((element) => element.getBoundingClientRect().y)
  await trigger.click()
  await expect(diff).toHaveCount(0)
  await expect.poll(bottom).toBeLessThanOrEqual(1)
  await expect.poll(() => trigger.evaluate((element) => element.getBoundingClientRect().y)).toBeGreaterThan(expandedY)

  await trigger.click()
  await expect(diff).toBeVisible()
  await expect.poll(measured).toBeLessThanOrEqual(1)
  await expect.poll(bottom).toBeLessThanOrEqual(1)
})

for (const outline of [
  { name: "shell outline at 1.25x", kind: "shell", deviceScaleFactor: 1.25 },
  { name: "shell outline at 1.5x", kind: "shell", deviceScaleFactor: 1.5 },
  { name: "patch card", kind: "patch", deviceScaleFactor: undefined },
] as const) {
  test(`keeps the ${outline.name} inside a fractionally short virtual row`, async ({ page }) => {
    const partID = outline.kind === "shell" ? "prt_shell_outline" : "prt_patch_outline"
    const secondUserID = "msg_outline_second_user"

    const tool =
      outline.kind === "shell"
        ? shell(partID, "completed", "shell output")
        : toolPart(
            partID,
            "patch",
            "completed",
            { patchText: "Update src/outline.ts" },
            {
              metadata: {
                files: [
                  {
                    file: "src/outline.ts",
                    status: "modified",
                    patch:
                      "diff --git a/src/outline.ts b/src/outline.ts\n--- a/src/outline.ts\n+++ b/src/outline.ts\n@@ -1 +1 @@\n-const outline = false\n+const outline = true\n",
                    additions: 1,
                    deletions: 1,
                  },
                ],
              },
            },
          )

    // A second turn adds the fixed turn gap, which must not get the paint-rounding margin.
    await setupTimeline(page, {
      messages: [
        userMessage(undefined, {
          summary: {
            diffs: [
              {
                file: "src/summary.ts",
                additions: 1,
                deletions: 1,
                status: "modified",
                patch: "@@ -1 +1 @@\n-export const value = 1\n+export const value = 2",
              },
            ],
          },
        }),
        assistantMessage([tool]),
        userMessage(undefined, { id: secondUserID, created: 1700000010000 }),
        assistantMessage([], { id: "msg_outline_second_assistant", parentID: secondUserID, created: 1700000011000 }),
      ],
      settings:
        outline.kind === "shell"
          ? { shellToolPartsExpanded: true }
          : { timelineDetail: { ...timelinePresets[2].value, edit: { placement: "separate", details: "collapsed" } } },
      reducedMotion: true,
      deviceScaleFactor: outline.deviceScaleFactor,
    })
    await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()

    const rows = await page.locator("[data-timeline-key]").evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.querySelector<HTMLElement>("[data-timeline-row]")?.dataset.timelineRow,
        clipMargin: getComputedStyle(element).overflowClipMargin,
      })),
    )

    expect(rows.filter((row) => row.tag !== "TurnGap").every((row) => row.clipMargin === "0.5px")).toBe(true)
    expect(rows.filter((row) => row.tag === "TurnGap")).toEqual([{ tag: "TurnGap", clipMargin: "0px" }])

    const part = page.locator(`[data-timeline-part-id="${partID}"]`)
    const row = page.locator("[data-timeline-key]", { has: part })

    if (outline.kind === "patch") {
      const card = part.locator('[data-component="accordion"][data-scope="apply-patch"]')
      await expect(card.getByRole("button")).toHaveAttribute("aria-expanded", "false")

      const geometry = await row.evaluate((element) => {
        const card = element.querySelector<HTMLElement>('[data-component="accordion"][data-scope="apply-patch"]')

        if (!card) throw new Error("Patch card is unavailable")
        const cardRect = card.getBoundingClientRect()
        element.style.height = `${cardRect.bottom - element.getBoundingClientRect().top - 0.49}px`
        const clipMargin = getComputedStyle(element).overflowClipMargin
        const bottom = element.getBoundingClientRect().bottom

        return {
          overflow: card.getBoundingClientRect().bottom - bottom,
          paintOverflow: card.getBoundingClientRect().bottom - bottom - Number.parseFloat(clipMargin),
          cardWidth: cardRect.width,
          cardHeight: cardRect.height,
        }
      })

      expect(geometry.overflow).toBeCloseTo(0.49, 1)
      expect(geometry.paintOverflow).toBeLessThanOrEqual(0)
      const edges = await captureCardEdges(page, card)
      expect(edges.box.width).toBeCloseTo(geometry.cardWidth, 2)
      expect(edges.box.height).toBeCloseTo(geometry.cardHeight, 2)
      expect(edges.luminance.top).toBeLessThan(245)
      expect(edges.luminance.bottom).toBeLessThan(245)
      expect(Math.abs(edges.luminance.bottom - edges.luminance.top)).toBeLessThan(10)

      return
    }

    const bash = part.locator('[data-component="bash-output"]')
    await expect(bash).toBeVisible()
    await waitForVisualSettle(page, [`[data-timeline-part-id="${partID}"] [data-component="bash-output"]`])

    const geometry = await row.evaluate((element) => {
      const output = element.querySelector<HTMLElement>('[data-component="bash-output"]')

      if (!output) throw new Error("Shell output is unavailable")
      const outputRect = output.getBoundingClientRect()
      // Match a rounded-down measurement at a fractional device-pixel phase.
      element.style.height = `${outputRect.bottom - element.getBoundingClientRect().top - 0.49}px`
      element.style.transform = "translateY(0.25px)"
      output.style.setProperty("--v2-border-border-base", "rgb(255, 0, 255)")
      output.style.setProperty("background", "rgb(0, 0, 0)", "important")
      const style = getComputedStyle(output)

      return {
        outputWidth: outputRect.width,
        outputHeight: outputRect.height,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow,
      }
    })

    await expect
      .poll(() =>
        row.evaluate(
          (element) =>
            element.querySelector<HTMLElement>('[data-component="bash-output"]')!.getBoundingClientRect().bottom -
            element.getBoundingClientRect().bottom,
        ),
      )
      .toBeCloseTo(0.49, 1)
    expect(await page.evaluate(() => devicePixelRatio)).toBe(outline.deviceScaleFactor)
    const edges = await captureCardEdges(page, bash)
    expect(edges.box.width).toBeCloseTo(geometry.outputWidth, 2)
    expect(edges.box.height).toBeCloseTo(geometry.outputHeight, 2)
    expect(geometry.borderColor).toBe("rgb(255, 0, 255)")
    expect(geometry.boxShadow).toBe("none")
    expect(edges.magenta.top).toBeGreaterThan(0.75)
    expect(edges.magenta.bottom).toBeGreaterThan(0.75)
    expect(edges.magenta.vertical).toBeGreaterThanOrEqual(2)
  })
}

for (const failed of [false, true]) {
  test(`keeps a submitted prompt in place until Working shows${failed ? " after an error" : ""}`, async ({ page }) => {
    await setupTimeline(page, {
      seedHistory: true,
      messages: [
        userMessage(),
        ...(failed
          ? [{ ...assistantMessage([]), error: { type: "provider.error", message: "Previous request failed" } }]
          : []),
      ],
    })
    const working = page.locator('[data-component="session-working"]')
    await expect(working).toHaveCount(0)
    const release = Promise.withResolvers<void>()
    await page.route(`**/api/session/${sessionID}/prompt`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      await release.promise

      return route.fallback()
    })

    const text = "Observe optimistic prompt spacing."
    const editor = page.locator('[data-component="composer"]').getByRole("textbox")
    await expect(editor).toBeEditable()
    await editor.fill(text)
    await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()

    const bottom = () =>
      page.locator("[data-timeline-virtual-content]").evaluate((element) => {
        const root = element.parentElement!

        return root.scrollHeight - root.clientHeight - root.scrollTop
      })

    await expect.poll(bottom).toBe(0)

    // Records the prompt row in every frame from submission until Working has shown.
    const observation = await page.evaluateHandle((text) => {
      const frames: { prompt?: number; working: boolean }[] = []
      let frame = 0

      const sample = () => {
        const prompt = [...document.querySelectorAll<HTMLElement>('[data-timeline-row="UserMessage"]')].find((row) =>
          row.textContent?.includes(text),
        )

        frames.push({
          ...(prompt ? { prompt: prompt.getBoundingClientRect().y } : {}),
          working: !!document.querySelector('[data-component="session-working"]'),
        })
        frame = requestAnimationFrame(sample)
      }

      frame = requestAnimationFrame(sample)

      return {
        stop: () => {
          cancelAnimationFrame(frame)

          return frames
        },
      }
    }, text)

    const requested = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/prompt`,
    )

    try {
      await editor.press("Enter")
      expect((await requested).postDataJSON()).toMatchObject({ text })
      await expect(page.locator('[data-timeline-row="UserMessage"]').filter({ hasText: text })).toBeInViewport()
      await expect(working).toHaveRole("status")
      await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
      await expect(working).toBeInViewport()
      await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
      await expect.poll(bottom).toBe(0)
      const frames = await observation.evaluate((value) => value.stop())
      expect(frames.some((frame) => frame.working && frame.prompt === undefined)).toBe(false)
      const positions = frames.flatMap((frame) => (frame.prompt === undefined ? [] : [frame.prompt]))
      expect(positions.length).toBeGreaterThan(0)
      expect(new Set(positions).size).toBe(1)
    } finally {
      release.resolve()
      await observation.dispose()
    }
  })
}

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
      const scale = { x: image.naturalWidth / viewport.width, y: image.naturalHeight / viewport.height }

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
    { source: `data:image/png;base64,${screenshot.toString("base64")}`, viewport, box },
  )
}
