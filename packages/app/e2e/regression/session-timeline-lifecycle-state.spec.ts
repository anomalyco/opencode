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

test("transitions thinking and hidden reasoning through busy to idle", async ({ page }) => {
  const reasoningID = "prt_reasoning_hidden"
  const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistant],
    settings: { showReasoningSummaries: false },
    cpuRate: 4,
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(reasoningID)}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "running")), 160)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "completed", "done")), 180)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 100)
  await timeline.send(status("idle"), 300)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(reasoningID)}"]`)).toHaveCount(0)
})

test("moves busy through retry and recovery to final idle content", async ({ page }) => {
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
  await timeline.send(status("busy"), 140)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toHaveCount(0)
  await timeline.send(status("retry"), 180)
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.send(stepStarted(assistant), 180)
  await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(textPart("prt_recovered", "Recovered response")), 140)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 100)
  await timeline.send(status("idle"), 350)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID("prt_recovered")}"]`)).toContainText(
    "Recovered response",
  )
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
