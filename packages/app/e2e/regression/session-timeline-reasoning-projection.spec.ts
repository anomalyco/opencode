import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  messageUpdated,
  partDelta,
  partUpdated,
  reasoningPart,
  setupTimeline,
  status,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const profiles = [
  { name: "summaries off no reasoning", summaries: false, reasoning: "", other: false, thinking: true, body: false },
  {
    name: "summaries off reasoning heading",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries off with visible tool",
    summaries: false,
    reasoning: "## Inspecting stability",
    other: true,
    thinking: true,
    body: false,
  },
  { name: "summaries on no content", summaries: true, reasoning: "", other: false, thinking: true, body: false },
  {
    name: "summaries on blank reasoning",
    summaries: true,
    reasoning: "   ",
    other: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries on visible reasoning",
    summaries: true,
    reasoning: "## Inspecting stability",
    other: false,
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    summaries: true,
    reasoning: "",
    other: true,
    thinking: false,
    body: false,
  },
] as const

for (const profile of profiles) {
  test(`projects busy reasoning profile ${profile.name}`, async ({ page }) => {
    const reasoningID = `prt_reasoning_matrix_${profiles.indexOf(profile)}`
    const parts = [
      ...(profile.reasoning ? [reasoningPart(reasoningID, profile.reasoning)] : []),
      ...(profile.other
        ? [toolPart(`prt_reasoning_tool_${profiles.indexOf(profile)}`, "skill", "running", { name: "inspect" })]
        : []),
    ]
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(parts, { completed: false })],
      settings: { showReasoningSummaries: profile.summaries },
    })
    await timeline.send(status("busy"), 150)

    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(profile.thinking ? 1 : 0)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(profile.body ? 1 : 0)
    if (!profile.summaries && profile.reasoning.trim()) {
      await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
    }
  })
}

test("does not infer reasoning visibility from provider identity", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_provider_text", "No reasoning payload")], { completed: false }),
    ],
    settings: { showReasoningSummaries: true },
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-part-id="prt_provider_text"]')).toBeVisible()
})

for (const newLayoutDesigns of [false, true]) {
  test(`turn elapsed time continues from the request through reasoning, answer, and retry (v2=${newLayoutDesigns})`, async ({
    page,
  }) => {
    const start = Date.now()
    await page.clock.setFixedTime(start + 3000)
    const reasoning = { ...reasoningPart("prt_turn_01", "Checking."), time: { start: start + 2000 } }
    const assistant = assistantMessage([reasoning], { created: start + 2000, completed: false })
    const timeline = await setupTimeline(page, {
      messages: [userMessage(undefined, { created: start }), assistant],
      settings: { showReasoningSummaries: false, newLayoutDesigns },
    })
    const elapsed = page.locator('[data-slot="session-turn-thinking"]')
    await expect(elapsed).toContainText("Thinking for 3s")
    await page.clock.setFixedTime(start + 8000)
    await timeline.send(partUpdated({ ...reasoning, time: { start: start + 2000, end: start + 8000 } }))
    await timeline.send(partUpdated(textPart("prt_turn_02", "Answer.")))
    await expect(page.getByText("Answer.", { exact: true })).toBeVisible()
    await expect(elapsed).toContainText("Thinking for 8s")

    // A retry replaces the status row; remounting it must keep the same request clock.
    await timeline.send(status("retry"))
    await expect(elapsed).toBeHidden()
    await page.clock.setFixedTime(start + 15000)
    await timeline.send(status("busy"))
    await expect(elapsed).toContainText("Thinking for 15s")
    await page.clock.setFixedTime(start + 20000)
    await timeline.send(partDelta("prt_turn_02", " More detail."))
    await expect(page.getByText("Answer. More detail.", { exact: true })).toBeVisible()
    await expect(elapsed).toContainText("Thinking for 20s")

    await timeline.send(
      messageUpdated({ ...assistant.info, time: { ...assistant.info.time, completed: start + 25000 } }),
    )
    await timeline.send(status("idle"))
    const total = page.locator('[data-slot="text-part-meta"]')
    await expect(elapsed).toBeHidden()
    await expect(total).toContainText("Total 25s")
    await page.clock.setFixedTime(start + 60000)
    await expect(total).toContainText("Total 25s")
  })

  test(`reasoning streams, toggles, and collapses when the answer starts (v2=${newLayoutDesigns})`, async ({
    page,
  }) => {
    const reasoning = reasoningPart("prt_reasoning_01", "Checking the first condition.")
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoning], { completed: false })],
      settings: { showReasoningSummaries: true, newLayoutDesigns },
    })
    const section = page.locator(`[data-timeline-part-id="${reasoning.id}"]`)
    await expect(section).toBeVisible()
    const toggle = section.getByRole("button", { name: /^(Thinking|Thought) for / })
    const body = section.getByText("Checking the first condition.", { exact: true })
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(body).toBeVisible()
    if (newLayoutDesigns) await page.screenshot({ path: test.info().outputPath("reasoning-expanded.png") })
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(body).toBeHidden()
    await timeline.send(partDelta(reasoning.id, " The second condition also holds."))
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(section.getByText("The second condition also holds.", { exact: false })).toBeHidden()
    await toggle.click()
    await expect(section.getByText("The second condition also holds.", { exact: false })).toBeVisible()

    // The answer starts before the assistant message is marked complete.
    await timeline.send(partUpdated(textPart("prt_reasoning_02", "Here is the answer.")))
    await expect(page.getByText("Here is the answer.", { exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(section.getByText("The second condition also holds.", { exact: false })).toBeHidden()
    if (newLayoutDesigns) await page.screenshot({ path: test.info().outputPath("reasoning-collapsed.png") })
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(section.getByText("The second condition also holds.", { exact: false })).toBeVisible()
    await timeline.send(partDelta("prt_reasoning_02", " More detail."))
    await timeline.send(messageUpdated(assistantMessage().info))
    await timeline.send(status("idle"))
    await expect(page.getByText("Here is the answer. More detail.", { exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await toggle.focus()
    await page.keyboard.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
  })
}

test("completed reasoning starts collapsed and can be reopened", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        {
          ...reasoningPart("prt_reasoning_history", "Saved reasoning."),
          time: { start: 1700000001000, end: 1700000013000 },
        },
        textPart("prt_saved_answer", "Saved answer."),
      ]),
    ],
    settings: { showReasoningSummaries: true },
  })
  const toggle = page.getByRole("button", { name: /^(Thinking|Thought) for / })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toHaveAccessibleName("Thought for 12s")
  await expect(page.getByText("Saved reasoning.", { exact: true })).toBeHidden()
  await toggle.click()
  await expect(page.getByText("Saved reasoning.", { exact: true })).toBeVisible()
})

test("reasoning is shown by default when the preference has not been saved", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([reasoningPart("prt_default_reasoning", "Default reasoning.")], { completed: false }),
    ],
    settings: null,
  })
  const toggle = page.getByRole("button", { name: /^(Thinking|Thought) for / })
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByText("Default reasoning.", { exact: true })).toBeVisible()
  await timeline.send(status("idle"))
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(page.getByText("Default reasoning.", { exact: true })).toBeVisible()
})

for (const newLayoutDesigns of [false, true]) {
  test(`reasoning shows elapsed time and keeps the completed duration (v2=${newLayoutDesigns})`, async ({ page }) => {
    const start = Date.now()
    await page.clock.setFixedTime(start)
    const reasoning = {
      ...reasoningPart("prt_timed_reasoning", "Checking the result."),
      time: { start },
    }
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoning], { completed: false })],
      settings: { showReasoningSummaries: true, newLayoutDesigns },
    })
    const section = page.locator(`[data-timeline-part-id="${reasoning.id}"]`)
    const toggle = section.getByRole("button", { name: /^(Thinking|Thought) for / })
    await expect(toggle).toHaveAccessibleName("Thinking for 0s")
    await page.clock.setFixedTime(start + 5000)
    await expect(toggle).toHaveAccessibleName("Thinking for 5s")
    await timeline.send(partUpdated({ ...reasoning, time: { start, end: start + 65000 } }))
    await expect(toggle).toHaveAccessibleName("Thought for 1m 5s")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await page.clock.setFixedTime(start + 120000)
    await timeline.send(partUpdated(textPart("prt_timed_answer", "Here is the result.")))
    await timeline.send(messageUpdated(assistantMessage().info))
    await timeline.send(status("idle"))
    await expect(toggle).toHaveAccessibleName("Thought for 1m 5s")
    await toggle.click()
    await expect(section.getByText("Checking the result.", { exact: true })).toBeVisible()
  })
}

test("reasoning without an end timestamp stops timing when the answer starts", async ({ page }) => {
  const start = Date.now()
  await page.clock.setFixedTime(start)
  const reasoning = { ...reasoningPart("prt_unfinished_01", "Checking."), time: { start } }
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([reasoning], { completed: false })],
    settings: { showReasoningSummaries: true },
  })
  const toggle = page.locator(`[data-timeline-part-id="${reasoning.id}"]`).getByRole("button")
  await expect(toggle).toHaveAccessibleName("Thinking for 0s")
  await page.clock.setFixedTime(start + 5000)
  await timeline.send(partUpdated(textPart("prt_unfinished_02", "Answer.")))
  await expect(toggle).toHaveAccessibleName("Thought for 5s")
  await page.clock.setFixedTime(start + 60000)
  const completed = assistantMessage().info
  await timeline.send(messageUpdated({ ...completed, time: { ...completed.time, completed: start + 60000 } }))
  await timeline.send(status("idle"))
  await expect(toggle).toHaveAccessibleName("Thought for 5s")
})
