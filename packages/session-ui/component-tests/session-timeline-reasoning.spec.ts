import { expect, story } from "../../storybook/playwright/story"

const profiles = [
  { name: "summaries off no reasoning", summaries: false, reasoning: "none", tool: false, thinking: true, body: false },
  {
    name: "summaries off reasoning heading",
    summaries: false,
    reasoning: "heading",
    tool: false,
    thinking: true,
    body: false,
    heading: true,
  },
  {
    name: "summaries off with visible tool",
    summaries: false,
    reasoning: "heading",
    tool: true,
    thinking: true,
    body: false,
    heading: true,
  },
  { name: "summaries on no content", summaries: true, reasoning: "none", tool: false, thinking: true, body: false },
  {
    name: "summaries on blank reasoning",
    summaries: true,
    reasoning: "blank",
    tool: false,
    thinking: true,
    body: false,
  },
  {
    name: "summaries on visible reasoning",
    summaries: true,
    reasoning: "heading",
    tool: false,
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    summaries: true,
    reasoning: "none",
    tool: true,
    thinking: false,
    body: false,
  },
] as const

for (const profile of profiles) {
  // Moved from packages/app/e2e/regression/session-timeline-reasoning-projection.spec.ts
  story(`projects busy reasoning profile ${profile.name}`, async ({ mount }) => {
    const timeline = await mount("current-session-timeline-rows--agent-reasoning", {
      args: { summaries: profile.summaries, reasoning: profile.reasoning, tool: profile.tool },
    })
    await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(profile.thinking ? 1 : 0)
    await expect(timeline.locator('[data-timeline-part-id="msg_projection_assistant:reasoning:0"]')).toHaveCount(
      profile.body ? 1 : 0,
    )
    if ("heading" in profile) {
      await expect(timeline.getByText("Inspecting stability", { exact: true })).toBeVisible()
    }
  })
}

// Moved from packages/app/e2e/regression/session-timeline-reasoning-projection.spec.ts
story("does not infer reasoning visibility from provider identity", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--agent-reasoning", {
    args: { reasoning: "none", text: "No reasoning payload" },
  })
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(timeline.getByText("No reasoning payload", { exact: true })).toBeVisible()
})
