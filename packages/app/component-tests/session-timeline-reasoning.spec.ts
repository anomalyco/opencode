import { expect, story } from "./story"

const profiles = [
  { name: "summaries off no reasoning", id: "summaries-off-no-reasoning", thinking: true, body: false },
  {
    name: "summaries off reasoning heading",
    id: "summaries-off-reasoning-heading",
    thinking: true,
    body: false,
    heading: true,
  },
  {
    name: "summaries off with visible tool",
    id: "summaries-off-with-visible-tool",
    thinking: true,
    body: false,
    heading: true,
  },
  { name: "summaries on no content", id: "summaries-on-no-content", thinking: true, body: false },
  { name: "summaries on blank reasoning", id: "summaries-on-blank-reasoning", thinking: true, body: false },
  {
    name: "summaries on visible reasoning",
    id: "summaries-on-visible-reasoning",
    thinking: false,
    body: true,
  },
  {
    name: "summaries on visible tool no reasoning",
    id: "summaries-on-visible-tool-no-reasoning",
    thinking: false,
    body: false,
  },
] as const

for (const profile of profiles) {
  // Moved from packages/app/e2e/regression/session-timeline-reasoning-projection.spec.ts
  story(`projects busy reasoning profile ${profile.name}`, async ({ mount }) => {
    const timeline = await mount(`current-session-reasoning-projection--${profile.id}`)
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
  const timeline = await mount("current-session-reasoning-projection--provider-without-reasoning")
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-part-id*="reasoning"]')).toHaveCount(0)
  await expect(timeline.getByText("No reasoning payload", { exact: true })).toBeVisible()
})
