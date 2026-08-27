import { expect, test } from "@playwright/test"
import {
  assistantID,
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  reasoningPart,
  renderedPartID,
  setupTimeline,
  shell,
  sessionID,
  status,
  stepStarted,
  textPart,
  toolCalled,
  toolInputEnded,
  toolInputStarted,
  userMessage,
} from "../performance/timeline-stability/fixture"

for (const expanded of [false, true]) {
  test(`preserves shell user intent from a ${expanded ? "expanded" : "collapsed"} default`, async ({ page }) => {
    const id = `prt_shell_default_${expanded}`
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([shell(id, "completed", lines(3))])],
      settings: { shellToolPartsExpanded: expanded },
    })
    const trigger = expanded
      ? page.locator(`[data-timeline-part-id="${id}"] [data-slot="collapsible-trigger"]`)
      : page.getByRole("button", { name: "Used Shell" })
    await expect(trigger).toHaveAttribute("aria-expanded", String(expanded))
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))

    await timeline.send(partUpdated(shell(id, "completed", lines(6))), 180)
    await timeline.send(partUpdated(textPart(`prt_sibling_${expanded}`, "Sibling content")), 180)
    await timeline.send(status("busy"), 100)
    await timeline.send(status("idle"), 250)
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))
  })
}

test("transitions a streaming shell from writing through command execution", async ({ page }) => {
  const id = "prt_shell_streaming_input"
  const command = "printf ready"
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([], { completed: false })],
  })
  await timeline.send(toolInputStarted({ sessionID, assistantMessageID: assistantID, id, name: "shell" }))

  const tool = page.locator(`[data-timeline-part-id="${id}"]`)
  const title = tool.locator('[data-slot="basic-tool-tool-title"]')
  const titleShimmer = title.locator('[data-component="text-shimmer"]')
  const subtitle = tool.locator('[data-slot="basic-tool-tool-subtitle"]')
  await expect(titleShimmer).toHaveAttribute("aria-label", "Shell")
  await expect(titleShimmer).toHaveAttribute("data-active", "true")
  await expect(subtitle).toHaveText("Writing command...")
  await expect(subtitle.locator('[data-component="text-shimmer"]')).toHaveCount(0)
  await expect(tool.locator('[data-component="shell-submessage"]')).toHaveCount(0)
  await expect(tool.locator('[data-slot="collapsible-trigger"]')).toHaveCSS("height", "28px")
  await expect(tool.locator('[data-component="tool-trigger"]')).toHaveCSS("gap", "6px")
  await expect(title).toHaveCSS("font-size", "13px")
  await expect(title).toHaveCSS("font-family", /^Inter,/)
  await expect(title).toHaveCSS("font-weight", "530")
  await expect(title).toHaveCSS("line-height", "16px")
  await expect(title).toHaveCSS("color", "rgb(22, 22, 22)")
  await expect(subtitle).toHaveCSS("font-size", "13px")
  await expect(subtitle).toHaveCSS("font-family", /^Inter,/)
  await expect(subtitle).toHaveCSS("font-weight", "440")
  await expect(subtitle).toHaveCSS("line-height", "16px")
  await expect(subtitle).toHaveCSS("color", "rgb(92, 92, 92)")

  const input = JSON.stringify({ command })
  await timeline.send(toolInputEnded({ sessionID, assistantMessageID: assistantID, id, text: input }))
  await expect(titleShimmer).toHaveAttribute("data-active", "true")
  await expect(subtitle).toHaveText(command)
  await expect(tool).not.toContainText("Writing command...")

  await timeline.send(
    toolCalled({
      sessionID,
      assistantMessageID: assistantID,
      id,
      input: { command },
      executed: true,
    }),
  )
  await expect(titleShimmer).toHaveAttribute("data-active", "true")
  await expect(subtitle).toHaveText(command)
})

test("shimmers and expands a running shell command", async ({ page }) => {
  const id = "prt_shell_running_command"
  const command = "sleep 10 && echo done"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([shell(id, "running", "still running", command)], { completed: false })],
    settings: { shellToolPartsExpanded: false },
  })

  const tool = page.locator(`[data-timeline-part-id="${id}"]`)
  await expect(tool.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
  await expect(tool).not.toContainText("Writing command...")
  await expect(tool.locator('[data-component="shell-submessage"]')).toHaveText(command)
  await expect(tool.locator('[data-component="shell-submessage"] [data-component="text-shimmer"]')).toHaveCount(0)
  await expect(tool.locator('[data-slot="collapsible-trigger"]')).toHaveCSS("height", "28px")
  await tool.locator('[data-slot="collapsible-trigger"]').click()
  await expect(tool.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
  await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("still running")
})

for (const open of [false, true]) {
  test(`keeps ${open ? "expanded" : "collapsed"} reasoning intent from Thinking through standalone shell into Used`, async ({
    page,
  }) => {
    const reasoningID = `prt_reasoning_hidden_${open}`
    const shellID = `prt_reasoning_shell_${open}`
    const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistant],
      settings: { showReasoningSummaries: false },
      cpuRate: 4,
    })
    const reasoning = page.locator(`[data-timeline-part-id="${renderedPartID(reasoningID)}"]`)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
    const thought = reasoning.locator('[data-slot="collapsible-trigger"]')
    await expect(thought).toHaveAttribute("aria-expanded", "false")
    await thought.click()
    await expect(thought).toHaveAttribute("aria-expanded", "true")
    if (!open) await thought.click()
    await expect(thought).toHaveAttribute("aria-expanded", String(open))
    await timeline.send(partUpdated(shell(shellID, "running")))
    const group = page.locator('[data-component="collapsed-tool-group"]')
    await expect(page.locator(`[data-timeline-part-id="${shellID}"]`)).toBeVisible()
    await expect(group).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(thought).toContainText("Thought")
    await expect(thought).not.toContainText("Inspecting stability")
    await expect(thought).toHaveAttribute("aria-expanded", String(open))
    await timeline.send(partUpdated(shell(shellID, "completed", "done")))
    await timeline.send(messageUpdated(completedAssistantInfo(assistant)))
    await timeline.send(status("idle"))
    const used = group.getByRole("button", { name: "Used Shell", exact: true })
    await expect(used).toHaveAttribute("aria-expanded", "false")
    await used.click()
    await expect(used).toHaveAttribute("aria-expanded", "true")
    await expect(group.locator(`[data-timeline-part-id="${shellID}"]`)).toBeVisible()
    await expect(group.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
      "aria-expanded",
      String(open),
    )
    await expect(group.locator('[data-component="tag"]')).toHaveText("1")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(used).toHaveAttribute("aria-expanded", "true")
    if (!open) await thought.click()
    await expect(reasoning.getByRole("heading", { name: "Inspecting stability", exact: true })).toBeVisible()
    await used.click()
    await expect(used).toHaveAttribute("aria-expanded", "false")
    await used.click()
    await expect(reasoning.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    await expect(reasoning.getByRole("heading", { name: "Inspecting stability", exact: true })).toBeVisible()
  })
}

for (const transition of ["reasoning-end", "idle", "retry"] as const) {
  test(`stops active Thinking on ${transition} without a following tool`, async ({ page }) => {
    const id = `prt_reasoning_stop_${transition}`
    const text = "## Inspecting stability\n\nThe timeline is ready for the next step."
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoningPart(id, text)], { completed: false })],
    })
    const part = page.locator(`[data-timeline-part-id="${renderedPartID(id)}"]`)
    const trigger = part.locator('[data-slot="collapsible-trigger"]')
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await timeline.send(transition === "reasoning-end" ? partUpdated(reasoningPart(id, text)) : status(transition))
    await expect(trigger).toContainText("Thought")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(transition === "retry" ? 1 : 0)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(part.getByText("The timeline is ready for the next step.", { exact: true })).toBeVisible()
  })
}

test("does not infer Thinking from busy, retry, or recovery without reasoning", async ({ page }) => {
  const assistant = assistantMessage([], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(undefined, {
        summary: {
          diffs: [
            {
              file: "src/retry.ts",
              additions: 1,
              deletions: 1,
              status: "modified",
              patch: "@@ -1 +1 @@\n-export const retry = false\n+export const retry = true",
            },
          ],
        },
      }),
      assistant,
    ],
  })
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toHaveCount(0)
  await timeline.send(status("retry"))
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.send(stepStarted(assistant))
  await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.send(partUpdated(textPart("prt_recovered", "Recovered response")))
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)))
  await timeline.send(status("idle"))
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID("prt_recovered")}"]`)).toContainText(
    "Recovered response",
  )
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
