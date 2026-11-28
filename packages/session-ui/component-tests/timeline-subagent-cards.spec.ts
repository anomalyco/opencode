import { expect, story } from "../../stories/playwright/story"

const consecutive = "current-session-research-agents--consecutive-subagents"
const research = "current-session-research-agents--agent-research"

// A subagent's card is a block of its own: the current timeline's 28px click-area rule for rows of text must not
// squeeze it, so consecutive cards keep the 16px block gap both standalone and inside an opened group.
for (const placement of ["separate", "grouped"] as const) {
  story(`consecutive subagent cards stand 16px apart when ${placement}`, async ({ mount }) => {
    const timeline = await mount(consecutive, { args: { subagents: placement } })

    if (placement === "grouped") {
      await timeline.locator('[data-component="collapsed-tool-group"] [data-slot="collapsible-trigger"]').click()
    }

    const surfaces = timeline.locator('[data-component="task-tool-surface"]')

    await expect(surfaces).toHaveCount(4)

    const boxes = await surfaces.evaluateAll((elements) =>
      elements.map((element) => {
        const surface = element.getBoundingClientRect()
        const trigger = element.closest('[data-slot="collapsible-trigger"]')!.getBoundingClientRect()

        return {
          height: surface.height,
          top: surface.top,
          bottom: surface.bottom,
          triggerTop: trigger.top,
          triggerBottom: trigger.bottom,
        }
      }),
    )

    for (const box of boxes) {
      expect(box.height).toBe(36)
      expect(box.top).toBe(box.triggerTop)
      expect(box.bottom).toBe(box.triggerBottom)
    }

    for (const [index, box] of boxes.slice(1).entries()) expect(box.top - boxes[index]!.bottom).toBe(16)
  })
}

// An error card's trigger keeps the 28px click area (16px line + 6px padding above and below) rather than collapsing to
// tool-error-card.css's 24px height with 12px of padding, which would squeeze its title into a 12px box.
story("tool error card triggers keep their 28px click area in the current timeline", async ({ mount }) => {
  const timeline = await mount(research, { args: { scenario: "failures" } })
  const triggers = timeline.locator(
    '[data-component="card"][data-kind="tool-error-card"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
  )

  await expect(triggers.first()).toBeVisible()
  expect(await triggers.count()).toBeGreaterThan(0)

  const heights = await triggers.evaluateAll((elements) =>
    elements.map((element) => {
      const trigger = element.getBoundingClientRect()
      const content = element.querySelector('[data-slot="basic-tool-tool-trigger-content"]')!.getBoundingClientRect()

      return {
        triggerHeight: trigger.height,
        contentTop: content.top,
        contentBottom: content.bottom,
        triggerTop: trigger.top,
        triggerBottom: trigger.bottom,
      }
    }),
  )

  for (const box of heights) {
    expect(box.triggerHeight).toBe(28)
    expect(box.contentTop).toBeGreaterThanOrEqual(box.triggerTop)
    expect(box.contentBottom).toBeLessThanOrEqual(box.triggerBottom)
  }
})
