import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"
import { timelinePresets } from "../src/timeline/detail"

const fixture = sourceURL(new URL("./work-steps.fixture.tsx", import.meta.url))

async function mountFixture(
  page: Page,
  options: {
    timeline: "current" | "next"
    view: "compact" | "standard" | "detailed" | "verbose"
    scenario?: "work" | "replies" | "native" | "shell-separate"
    nativeExpanded?: boolean
    foldedReplies?: "all" | "final"
    collapseTiming?: "completion" | "next-input"
  },
) {
  const timelineDetail =
    options.scenario === "native" || options.scenario === "shell-separate"
      ? {
          ...timelinePresets.find((preset) => preset.id === "compact")!.value,
          shell: {
            placement: options.scenario === "shell-separate" ? ("separate" as const) : ("grouped" as const),
            details: options.nativeExpanded ? ("expanded" as const) : ("collapsed" as const),
          },
          edit: {
            placement: "grouped" as const,
            details: options.nativeExpanded ? ("expanded" as const) : ("collapsed" as const),
          },
          thinking: {
            placement: "grouped" as const,
            details: options.nativeExpanded ? ("expanded" as const) : ("collapsed" as const),
          },
        }
      : undefined

  await page.evaluate(
    async ({ fixture, options, timelineDetail }) => {
      const { mountWorkSteps } = await import(fixture)
      mountWorkSteps({
        timeline: options.timeline,
        scenario: options.scenario,
        timelineDetail,
        workSteps: {
          view: options.view,
          foldedReplies: options.foldedReplies ?? "all",
          collapseTiming: options.collapseTiming ?? "completion",
        },
      })
    },
    { fixture, options, timelineDetail },
  )

  return page.getByTestId("work-steps-fixture")
}

for (const timeline of ["current", "next"] as const) {
  for (const view of ["standard", "compact"] as const) {
    story(`${timeline} ${view} keeps phases from one response independent`, async ({ mount, page }) => {
      await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
      const root = await mountFixture(page, { timeline, view })
      const work = root.locator('[data-component="work-steps-disclosure"]')
      const trigger = work.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

      await expect(work).toHaveCount(1)
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(root.getByText("Intermediate update", { exact: true })).toBeVisible()

      const phase = root.locator('[data-component="collapsed-tool-group"]')

      const phaseTrigger = phase
        .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
        .first()

      const secondPhase = root
        .locator('[data-component="collapsed-tool-group"]')
        .nth(1)
        .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

      await expect(phaseTrigger).toHaveAttribute("aria-expanded", "false")
      await expect(secondPhase).toHaveAttribute("aria-expanded", "false")
      await phaseTrigger.click()
      await expect(phaseTrigger).toHaveAttribute("aria-expanded", "true")
      await expect(secondPhase).toHaveAttribute("aria-expanded", "false")

      await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(phaseTrigger).toHaveAttribute("aria-expanded", "true")
      await expect(secondPhase).toHaveAttribute("aria-expanded", "false")
    })
  }

  for (const nativeExpanded of [true, false]) {
    story(`${timeline} keeps DSH phase lifecycle around ${nativeExpanded ? "expanded" : "collapsed"} native details`, async ({
      mount,
      page,
    }) => {
      await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })

      const root = await mountFixture(page, {
        timeline,
        view: "standard",
        scenario: "native",
        nativeExpanded,
      })

      const work = root.locator('[data-component="work-steps-disclosure"]')
      const workTrigger = work.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
      const phase = root.locator('[data-component="collapsed-tool-group"]').first()

      const phaseTrigger = phase.locator(
        ':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
      )

      await expect(workTrigger).toHaveAttribute("aria-expanded", "true")

      if (nativeExpanded) {
        await expect(phaseTrigger).toHaveAttribute("aria-expanded", "true")
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toBeVisible()
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toBeVisible()
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toBeVisible()

        await phaseTrigger.click()
        await expect(phaseTrigger).toHaveAttribute("aria-expanded", "false")
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toHaveCount(0)
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toHaveCount(0)
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toHaveCount(0)

        await phaseTrigger.click()
        await expect(phaseTrigger).toHaveAttribute("aria-expanded", "true")
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toBeVisible()
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toBeVisible()
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toBeVisible()

        const reasoning = root.locator(
          '[data-component="reasoning-part"][data-timeline-part-id="assistant-1:reasoning:0"]',
        )

        const reasoningTrigger = reasoning.locator(
          ':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
        )

        await expect(reasoningTrigger).toHaveAttribute("aria-expanded", "true")
        await reasoningTrigger.click()
        await expect(reasoningTrigger).toHaveAttribute("aria-expanded", "false")
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toHaveCount(0)
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toBeVisible()
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toBeVisible()
      } else {
        await expect(phaseTrigger).toHaveAttribute("aria-expanded", "false")
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toHaveCount(0)
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toHaveCount(0)
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toHaveCount(0)

        await phaseTrigger.click()
        await expect(phaseTrigger).toHaveAttribute("aria-expanded", "true")
        await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toHaveCount(0)
        await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toHaveCount(0)
        await expect(root.getByText(/NATIVE_EDIT_LINE/)).toHaveCount(0)
      }

      await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)
      await expect(workTrigger).toHaveAttribute("aria-expanded", "false")
      await expect(root.getByText("NATIVE_SHELL_OUTPUT", { exact: true })).toHaveCount(0)
      await expect(root.getByText("NATIVE_REASONING_BODY", { exact: true })).toHaveCount(0)
      await expect(root.getByText(/NATIVE_EDIT_LINE/)).toHaveCount(0)
    })

    story(
      `${timeline} renders ${nativeExpanded ? "expanded" : "collapsed"} native shells inside the open work area`,
      async ({ mount, page }) => {
        await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })

        const root = await mountFixture(page, {
          timeline,
          view: "standard",
          scenario: "shell-separate",
          nativeExpanded,
        })

        const work = root.locator('[data-component="work-steps-disclosure"]')

        const workTrigger = work.locator(
          ':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
        )

        const shellRows = work.locator('[data-component="tool-part-wrapper"][data-timeline-part-id^="tool-native-shell-"]')

        await expect(workTrigger).toHaveAttribute("aria-expanded", "true")
        await expect(shellRows).toHaveCount(7)
        await expect(work.locator('[data-component="collapsed-tool-group"]')).toHaveCount(0)
        await expect(work.getByText(/Used 7 Shell/)).toHaveCount(0)
        await expect(root.getByText("Native shell details complete", { exact: true })).toBeVisible()

        for (let index = 1; index <= 7; index++) {
          const output = root.getByText(`NATIVE_SHELL_${index}_OUTPUT`, { exact: true })

          if (nativeExpanded) await expect(output).toBeVisible()
          else await expect(output).toHaveCount(0)
        }

        await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)
        await expect(workTrigger).toHaveAttribute("aria-expanded", "false")
        await expect(root.getByText(/NATIVE_SHELL_\d+_OUTPUT/)).toHaveCount(0)

        await workTrigger.click()
        await expect(workTrigger).toHaveAttribute("aria-expanded", "true")
        await expect(shellRows).toHaveCount(7)

        if (nativeExpanded)
          await expect(root.getByText("NATIVE_SHELL_4_OUTPUT", { exact: true })).toBeVisible()
        else await expect(root.getByText("NATIVE_SHELL_4_OUTPUT", { exact: true })).toHaveCount(0)
      },
    )
  }

  story(`${timeline} standard shows live and settled detail while compact does not`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const standardRoot = await mountFixture(page, { timeline, view: "standard" })
    const standardDetail = standardRoot.locator('[data-slot="context-tool-group-detail-preview"]').first()

    await expect(standardDetail).toHaveText("read-1.ts")
    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    const outer = standardRoot.locator(
      '[data-component="work-steps-disclosure"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
    )

    await outer.click()
    await expect(standardRoot.locator('[data-slot="context-tool-group-detail-preview"]').first()).toHaveText(
      "Project inspection",
    )

    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const compactRoot = await mountFixture(page, { timeline, view: "compact" })
    await expect(compactRoot.locator('[data-slot="context-tool-group-detail-preview"]')).toHaveCount(0)
    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)
    await compactRoot
      .locator(
        '[data-component="work-steps-disclosure"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
      )
      .click()
    await expect(compactRoot.locator('[data-slot="context-tool-group-detail-preview"]')).toHaveCount(0)
  })

  story(`${timeline} final replies hide only while a completed turn is folded`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const root = await mountFixture(page, { timeline, view: "standard", foldedReplies: "final" })

    await expect(root.getByText("Intermediate update", { exact: true })).toBeVisible()
    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    const work = root.locator('[data-component="work-steps-disclosure"]')
    const trigger = work.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(root.getByText("Intermediate update", { exact: true })).toHaveCount(0)
    await expect(root.getByText("Final answer", { exact: true })).toBeVisible()

    await trigger.click()
    await expect(work).toHaveCount(1)
    await expect(root.getByText("Intermediate update", { exact: true })).toBeVisible()
  })

  story(`${timeline} text-only replies never hide without a work disclosure`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })

    const root = await mountFixture(page, {
      timeline,
      view: "standard",
      foldedReplies: "final",
      scenario: "replies",
    })

    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    await expect(root.locator('[data-component="work-steps-disclosure"]')).toHaveCount(0)
    await expect(root.getByText("Intermediate reply only", { exact: true })).toBeVisible()
    await expect(root.getByText("Final reply only", { exact: true })).toBeVisible()
  })

  story(`${timeline} all replies remain visible after completion`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const root = await mountFixture(page, { timeline, view: "standard", foldedReplies: "all" })
    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    await expect(root.getByText("Intermediate update", { exact: true })).toBeVisible()
    await expect(root.getByText("Final answer", { exact: true })).toBeVisible()
  })

  story(`${timeline} next-input keeps the latest completed turn open`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })

    const root = await mountFixture(page, {
      timeline,
      view: "standard",
      collapseTiming: "next-input",
      foldedReplies: "final",
    })

    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    const trigger = root.locator(
      '[data-component="work-steps-disclosure"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
    )

    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await page.evaluate(async (fixture) => (await import(fixture)).controls.addNextInput(), fixture)
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(root.getByText("Intermediate update", { exact: true })).toHaveCount(0)
  })

  story(`${timeline} detailed live work stays itemized`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const root = await mountFixture(page, { timeline, view: "detailed" })

    await expect(root.locator('[data-component="work-steps-disclosure"]')).toHaveCount(0)
    await expect(root.locator('[data-timeline-part-id="read-1"]')).toBeVisible()
    await expect(root.locator('[data-timeline-part-id="read-2"]')).toBeVisible()
  })

  story(`${timeline} verbose work stays itemized after completion`, async ({ mount, page }) => {
    await mount("current-session-timeline-rows--conversation", { args: { scenario: "reasoning" } })
    const root = await mountFixture(page, { timeline, view: "verbose" })
    await page.evaluate(async (fixture) => (await import(fixture)).controls.settle(), fixture)

    await expect(root.locator('[data-component="work-steps-disclosure"]')).toHaveCount(0)
    await expect(root.locator('[data-timeline-part-id="read-1"]')).toBeVisible()
    await expect(root.locator('[data-timeline-part-id="read-2"]')).toBeVisible()
  })
}

story("work steps playground renders with live and settled controls", async ({ mount, page }) => {
  const storyRoot = await mount("work-steps-playground--playground")
  const fixtureRoot = page.getByTestId("work-steps-fixture")

  await expect(storyRoot.getByRole("button", { name: "Live" })).toBeVisible()
  await expect(storyRoot.getByRole("button", { name: "Settled" })).toBeVisible()
  await expect(storyRoot.getByRole("button", { name: "Next input" })).toBeVisible()
  await expect(fixtureRoot.locator('[data-component="work-steps-disclosure"]')).toHaveCount(1)

  await storyRoot.getByRole("button", { name: "Settled" }).click()
  await expect(
    fixtureRoot.locator(
      '[data-component="work-steps-disclosure"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
    ),
  ).toHaveAttribute("aria-expanded", "false")
})
