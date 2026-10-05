import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import { assistantMessage, setupTimeline, textPart, toolPart, userMessage } from "../utils/timeline"

const before = Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}\n`).join("")
const after = before.replaceAll(" = ", " = 1 + ")
const files = ["src/a.ts", "src/b.ts"].map((file) => ({
  file,
  status: "modified",
  additions: 80,
  deletions: 80,
  patch: createTwoFilesPatch(file, file, before, after),
}))
// Five separated hunks, so the sticky header must stay put across hunk separators.
const long = Array.from({ length: 1_000 }, (_, index) => `export const value${index} = ${index}\n`)
const hunks = {
  file: "src/a.ts",
  status: "modified",
  additions: 50,
  deletions: 50,
  patch: createTwoFilesPatch(
    "src/a.ts",
    "src/a.ts",
    long.join(""),
    long
      .map((line, index) => (index % 200 >= 100 && index % 200 < 110 ? line.replace(" = ", " = 1 + ") : line))
      .join(""),
  ),
}
const scenarios = [
  {
    name: "grouped patch",
    placement: "grouped",
    tools: [toolPart("prt_sticky_patch", "patch", "completed", {}, { metadata: { files } })],
    files: ["a", "b"],
    title: false,
    offsets: [0],
  },
  {
    name: "standalone patch",
    placement: "separate",
    tools: [toolPart("prt_sticky_patch", "patch", "completed", {}, { metadata: { files } })],
    files: ["a", "b"],
    title: false,
    offsets: [0],
  },
  {
    name: "grouped multi-hunk edit",
    placement: "grouped",
    tools: [
      toolPart(
        "prt_sticky_edit",
        "edit",
        "completed",
        { path: "src/a.ts", oldString: before, newString: after },
        { metadata: { files: [hunks] } },
      ),
    ],
    files: ["a"],
    title: false,
    offsets: [0, 120, 240, 360, 480],
  },
  {
    name: "running edit input fallback",
    placement: "grouped",
    tools: [toolPart("prt_sticky_edit", "edit", "running", { path: "src/a.ts", oldString: before, newString: after })],
    files: ["a"],
    title: false,
    offsets: [0],
  },
  {
    name: "grouped write",
    placement: "grouped",
    tools: [toolPart("prt_sticky_write", "write", "completed", { path: "src/a.ts", content: after })],
    files: ["a"],
    title: false,
    offsets: [0],
  },
  {
    name: "running write input fallback",
    placement: "grouped",
    tools: [toolPart("prt_sticky_write", "write", "running", { path: "src/a.ts", content: after })],
    files: ["a"],
    title: false,
    offsets: [0],
  },
  {
    name: "merged edit write and patch",
    placement: "separate",
    tools: [
      toolPart("prt_sticky_edit", "edit", "completed", {}, { metadata: { files: [files[0]] } }),
      toolPart("prt_sticky_write", "write", "completed", { path: "src/b.ts", content: after }),
      toolPart(
        "prt_sticky_patch",
        "patch",
        "completed",
        {},
        { metadata: { files: [{ ...files[0], file: "src/c.ts" }] } },
      ),
    ],
    files: ["a", "b", "c"],
    title: false,
    offsets: [0],
  },
  {
    name: "created and deleted patch files",
    placement: "grouped",
    tools: [
      toolPart(
        "prt_sticky_patch",
        "patch",
        "completed",
        {},
        {
          metadata: {
            files: [
              {
                file: "src/a.ts",
                status: "added",
                additions: 80,
                deletions: 0,
                patch: createTwoFilesPatch("src/a.ts", "src/a.ts", "", after),
              },
              {
                file: "src/b.ts",
                status: "deleted",
                additions: 0,
                deletions: 80,
                patch: createTwoFilesPatch("src/b.ts", "src/b.ts", before, ""),
              },
            ],
          },
        },
      ),
    ],
    files: ["a", "b"],
    title: false,
    offsets: [0],
  },
] as const

for (const scenario of scenarios) {
  for (const [width, direction] of [
    [1400, "ltr"],
    [390, "rtl"],
  ] as const) {
    test(`${scenario.name}: file headers stay flush at ${width}px in ${direction}`, async ({ page }, info) => {
      await setupTimeline(page, {
        messages: [
          userMessage(),
          assistantMessage([...scenario.tools, textPart("prt_after_patch", "Following explanation.\n\n".repeat(60))]),
        ],
        settings: {
          timelineDetail: {
            ...timelinePresets[2].value,
            edit: { placement: scenario.placement, details: "collapsed" },
          },
        },
        reducedMotion: true,
        viewport: { width, height: 900 },
      })
      await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
      if (scenario.placement === "grouped") {
        await page.locator('[data-component="context-tool-group-trigger"]').click()
      }
      const patch = page.locator('[data-scope="apply-patch"]')
      await expect(patch).toHaveCount(1)
      const scroller = page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport')
      const toolTitle = scroller.locator('[data-slot="collapsible-trigger"][data-locked]')
      await expect(toolTitle).toHaveCount(scenario.title ? 1 : 0)
      await expect(scroller.locator("[data-session-title]")).toHaveCount(width === 1400 ? 1 : 0)

      for (const file of scenario.files) {
        const name = new RegExp(`${file}\\.ts`)
        const trigger = patch.getByRole("button", { name })
        const header = patch.getByRole("heading", { name })
        await expect(trigger).toHaveAttribute("aria-expanded", "false")
        await trigger.click()
        await expect(trigger).toHaveAttribute("aria-expanded", "true")
        const content = patch.getByRole("region", { name })
        await expect
          .poll(() => content.evaluate((element) => element.getBoundingClientRect().height))
          .toBeGreaterThan(900)

        // Leave follow-latest mode before positioning the viewport inside this file.
        await scroller.hover()
        await page.mouse.wheel(0, -100)
        await content.evaluate((element) => {
          const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
          viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + 160
        })
        await expect
          .poll(() =>
            content.evaluate((element) => {
              const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
              return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
            }),
          )
          .toBeLessThan(0)
        for (const [index, offset] of scenario.offsets.entries()) {
          if (index)
            await scroller.evaluate(
              (element, step) => (element.scrollTop += step),
              offset - scenario.offsets[index - 1]!,
            )
          await expect
            .poll(() =>
              header.evaluate((element) => {
                const viewport = element.closest<HTMLElement>(".scroll-view__viewport")!
                const title = viewport.querySelector("[data-session-title]")?.firstElementChild
                const toolTitle = element
                  .closest('[data-component="edit-tool"]')
                  ?.querySelector('[data-slot="collapsible-trigger"][data-locked]')
                // Grouped file headers stack below the stuck Used header.
                const group = element
                  .closest('[data-component="collapsed-tool-group"]')
                  ?.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
                const sessionTop = viewport.getBoundingClientRect().top + (title?.getBoundingClientRect().height ?? 0)
                const top = sessionTop + (group?.getBoundingClientRect().height ?? 0)
                const rect = element.getBoundingClientRect()
                const trigger = element.querySelector("button")!
                // The header stuck directly below the session title sits where the title's fade starts.
                const hits = (target: Element, box: DOMRect) =>
                  [box.top + 1, box.top + box.height / 2].every((y) =>
                    target.contains(document.elementFromPoint(box.left + box.width / 2, y)),
                  )
                return {
                  gap: Math.abs(rect.top - top - (toolTitle?.getBoundingClientRect().height ?? 0)),
                  groupGap: group ? Math.abs(group.getBoundingClientRect().top - sessionTop) : 0,
                  titleGap: toolTitle ? Math.abs(toolTitle.getBoundingClientRect().top - top) : 0,
                  clickable: hits(trigger, rect) && (!group || hits(group, group.getBoundingClientRect())),
                }
              }),
            )
            .toEqual({ gap: 0, groupGap: 0, titleGap: 0, clickable: true })
        }
        await page.screenshot({ path: info.outputPath(`${file}.png`) })
      }

      await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
      await expect(
        patch.getByRole("heading", { name: new RegExp(`${scenario.files.at(-1)}\\.ts`) }),
      ).not.toBeInViewport()
    })
  }
}
