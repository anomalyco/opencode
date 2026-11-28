import { expect, story } from "../../stories/playwright/story"

const consecutive = "current-session-research-agents--consecutive-subagents"

// A subagent's card is a block of its own: the current timeline's 28px click-area rule for rows of text must not
// squeeze it, so consecutive cards keep the gap between blocks rather than touching.
for (const flag of [false, true]) {
  story(`consecutive subagent cards stand apart with full_codemode ${flag ? "on" : "off"}`, async ({ mount }) => {
    const timeline = await mount(consecutive, { args: { full_codemode: flag } })
    const surfaces = timeline.locator('[data-component="task-tool-surface"]')

    await expect(surfaces).toHaveCount(4)

    const boxes = await surfaces.evaluateAll((elements) =>
      elements.map((element) => {
        const surface = element.getBoundingClientRect()
        const trigger = element.closest('[data-slot="collapsible-trigger"]')!.getBoundingClientRect()

        return { top: surface.top, bottom: surface.bottom, triggerTop: trigger.top, triggerBottom: trigger.bottom }
      }),
    )

    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(box.triggerTop)
      expect(box.bottom).toBeLessThanOrEqual(box.triggerBottom)
    }

    for (const [index, box] of boxes.slice(1).entries())
      expect(box.top - boxes[index]!.bottom).toBeGreaterThanOrEqual(8)
  })
}
