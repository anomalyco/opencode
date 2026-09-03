import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode-ai/session-ui/timeline/detail"
import {
  assistantID,
  assistantMessage,
  directory,
  partUpdated,
  reasoningPart,
  sessionID,
  setupTimeline,
  status,
  stepStarted,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

for (const width of [1400, 390]) {
  test(`shows Working between busy and reasoning states at ${width}px`, async ({ page }, testInfo) => {
    const timeline = await setupTimeline(page, {
      messages: [userMessage()],
      sessionStatus: { [sessionID]: { type: "busy" } },
      viewport: { width, height: 900 },
      settings: {
        timelineDetail: { ...timelinePresets[2].value, thinking: { placement: "separate", details: "collapsed" } },
      },
    })
    const working = page.locator('[data-component="session-working"]')
    await expect(working).toHaveCount(1)
    await expect(working).toHaveRole("status")
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveCSS("line-height", "16px")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`working-${width}.png`) })

    await timeline.send(stepStarted(assistantMessage([], { completed: false })))
    await expect(working).toBeVisible()
    const id = `prt_working_reasoning_${width}`
    await timeline.send(partUpdated(reasoningPart(id, "")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(working).toHaveCount(0)

    await timeline.send(partUpdated(reasoningPart(id, "The inspection is complete.")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()

    await timeline.send(status("idle"))
    await expect(working).toHaveCount(0)
  })
}

for (const name of ["shell", "patch", "subagent"] as const) {
  test(`hides Working during ${name} input and execution, then restores it on completion`, async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([], { completed: false })],
      settings: {
        timelineDetail: { ...timelinePresets[0].value, shell: { placement: "separate", details: "collapsed" } },
      },
    })
    const working = page.locator('[data-component="session-working"]')
    await expect(working).toBeVisible()

    const id = `prt_working_${name}`
    const input =
      name === "shell"
        ? { command: "printf ready" }
        : name === "patch"
          ? { patchText: "*** Begin Patch\n*** Add File: src/working.ts\n+export const ready = true\n*** End Patch" }
          : { agent: "general", description: "Inspect working indicator", prompt: "Inspect the timeline." }
    await timeline.send(partUpdated(toolPart(id, name, "streaming", input)))
    const tool = page.locator(`[data-timeline-part-id="${id}"]`)
    await expect(tool).toBeVisible()
    await expect(working).toHaveCount(0)

    const metadata =
      name === "patch"
        ? {
            files: [
              {
                file: "src/working.ts",
                status: "added",
                additions: 1,
                deletions: 0,
                patch: "@@ -0,0 +1 @@\n+export const ready = true",
              },
            ],
          }
        : {}
    await timeline.send(partUpdated(toolPart(id, name, "running", input, { metadata })))
    await expect(tool).toContainText(
      name === "shell" ? "printf ready" : name === "patch" ? "working.ts" : "Inspect working indicator",
    )
    await expect(working).toHaveCount(0)

    await timeline.send(partUpdated(toolPart(id, name, "completed", input, { metadata })))
    await expect(tool).toBeVisible()
    await expect(page.locator('[data-component="collapsed-tool-group"]')).toHaveCount(0)
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeVisible()
    await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
  })
}

for (const name of ["read", "shell", "subagent"] as const) {
  test(`keeps Working for grouped ${name} regardless of disclosure`, async ({ page }, testInfo) => {
    await setupTimeline(page, {
      viewport: { width: name === "shell" ? 390 : 1400, height: 900 },
      messages: [
        userMessage(),
        assistantMessage(
          [
            toolPart("prt_grouped_previous", "read", "completed", { filePath: "package.json" }),
            toolPart(
              "prt_grouped_active",
              name,
              "running",
              name === "shell"
                ? { command: "sleep 10" }
                : name === "subagent"
                  ? { agent: "general", description: "Inspect the timeline", prompt: "Inspect it." }
                  : { filePath: "src/working.ts" },
            ),
          ],
          { completed: false },
        ),
      ],
    })
    const working = page.locator('[data-component="session-working"]')
    const group = page.locator('[data-component="collapsed-tool-group"]')
    const trigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
    await expect(group).toHaveAttribute("data-timeline-part-ids", "prt_grouped_previous,prt_grouped_active")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(working).toBeInViewport()
    if (name !== "read") {
      const hint = page.locator('[data-component="session-background-hint"]')
      await expect(hint).toBeInViewport()
      await expect(page.locator('[data-component="session-background-hint-row"]')).toHaveCSS("height", "24px")
      await page.screenshot({ path: testInfo.outputPath(`working-grouped-${name}.png`) })
    }
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    if (name === "subagent") await expect(group.getByText("Inspect the timeline", { exact: true })).toBeVisible()
    if (name !== "subagent")
      await expect(group.locator('[data-component="text-shimmer"][data-active="true"]')).toBeVisible()
    await expect(working).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(working).toBeVisible()
  })
}

for (const grouped of [false, true]) {
  test(`uses ${grouped ? "grouped" : "standalone"} background shell presentation for Working`, async ({ page }) => {
    await setupTimeline(page, {
      settings: { shellToolPartsExpanded: !grouped },
      messages: [
        userMessage(),
        assistantMessage(
          [
            toolPart("prt_background_previous", "shell", "completed", { command: "echo ready" }),
            toolPart(
              "prt_background_active",
              "shell",
              "completed",
              { command: "sleep 10" },
              {
                metadata: { shellID: "sh_working_background", status: "running" },
              },
            ),
          ],
          { completed: false },
        ),
      ],
    })
    const working = page.locator('[data-component="session-working"]')
    const group = page.locator('[data-component="collapsed-tool-group"]')
    if (!grouped) {
      await expect(page.locator('[data-timeline-part-id="prt_background_active"]')).toBeVisible()
      await expect(working).toHaveCount(0)
      return
    }
    const trigger = group.getByRole("button", { name: "Used 2 Shell", exact: true, includeHidden: true })
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(working).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(working).toBeVisible()
  })
}

for (const name of ["shell", "subagent"] as const) {
  for (const placement of ["grouped", "hidden"] as const) {
    test(`shows no idle indicator for ${placement} background ${name}`, async ({ page }, testInfo) => {
      const timeline = await setupTimeline(page, {
        reducedMotion: true,
        viewport: { width: name === "shell" ? 1400 : 390, height: 900 },
        settings: {
          timelineDetail: {
            ...timelinePresets[2].value,
            shell: { placement, details: "collapsed" },
            subagents: { placement },
          },
        },
        messages: [
          userMessage(),
          assistantMessage([
            toolPart(
              "prt_idle_background",
              name,
              "completed",
              name === "shell"
                ? { command: "sleep 10" }
                : { agent: "general", description: "Inspect the timeline", prompt: "Inspect it." },
              { metadata: { [name === "shell" ? "shellID" : "sessionID"]: "background_task", status: "running" } },
            ),
            textPart("prt_idle_answer", "The task is running in the background."),
          ]),
        ],
      })
      const working = page.locator('[data-component="session-working"]')
      const running = page.getByRole("status").filter({ hasText: /^Running$/ })
      await expect(page.getByText("The task is running in the background.", { exact: true })).toBeVisible()
      await expect(working).toHaveCount(0)
      await expect(running).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(`idle-background-${name}-${placement}.png`) })

      await timeline.send(status("busy"))
      await expect(working).toHaveCount(1)
      await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
      await expect(running).toHaveCount(0)

      await timeline.send(status("idle"))
      await expect(working).toHaveCount(0)
      await expect(running).toHaveCount(0)
    })
  }
}

test("replaces Working with Retry and restores it on recovery", async ({ page }) => {
  const assistant = assistantMessage([], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  const working = page.locator('[data-component="session-working"]')
  await expect(working).toBeVisible()

  await timeline.send(status("retry"))
  const retry = page.locator('[data-timeline-row="Retry"]')
  await expect(retry).toContainText("Rate limited")
  await expect(working).toHaveCount(0)

  await timeline.send(stepStarted(assistant))
  await expect(retry).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
  await expect(working).toBeVisible()
})

test("hides Working while assistant text streams", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([], { completed: false })],
  })
  const working = page.locator('[data-component="session-working"]')
  await expect(working).toBeVisible()

  await timeline.send({
    id: "evt_working_text_started",
    type: "session.text.started",
    created: 1700000002000,
    location: { directory },
    durable: { aggregateID: sessionID, seq: 0, version: 1 },
    data: { sessionID, assistantMessageID: assistantID, ordinal: 0 },
  })
  await timeline.send({
    id: "evt_working_text_delta",
    type: "session.text.delta",
    created: 1700000002001,
    location: { directory },
    data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta: "The response is streaming." },
  })
  await expect(page.locator(`[data-timeline-part-id="${assistantID}:text:0"]`)).toContainText(
    "The response is streaming.",
  )
  await expect(working).toHaveCount(0)
})

for (const failed of [false, true]) {
  test(`shows Working before prompt admission or execution events${failed ? " after an error" : ""}`, async ({
    page,
  }) => {
    await setupTimeline(page, {
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
    const editor = page.locator('[data-component="composer"]').getByRole("textbox")
    await expect(editor).toBeEditable()
    await editor.fill("Check the working indicator immediately.")
    await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
    const requested = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/prompt`,
    )
    try {
      await editor.press("Enter")
      const request = await requested
      expect(request.postDataJSON()).toMatchObject({ text: "Check the working indicator immediately." })
      await expect(working).toHaveRole("status")
      await expect(working.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", "Working")
      await expect(working).toBeInViewport()
      await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    } finally {
      release.resolve()
    }
  })
}
