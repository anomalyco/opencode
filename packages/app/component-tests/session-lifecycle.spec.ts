import { expect, story } from "./story"

for (const expanded of [false, true]) {
  // Moved from packages/app/e2e/regression/session-timeline-lifecycle-state.spec.ts
  story(`preserves shell user intent from a ${expanded ? "expanded" : "collapsed"} default`, async ({ mount }) => {
    const timeline = await mount(
      `current-session-tool-projection--${expanded ? "expanded-shell-updates" : "collapsed-shell-updates"}`,
    )
    const trigger = timeline.locator('[data-timeline-part-id="tool_shell_lifecycle"] [data-slot="collapsible-trigger"]')
    await expect(trigger).toHaveAttribute("aria-expanded", String(expanded))
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))
    await timeline.getByRole("button", { name: "Update output" }).click()
    await expect(timeline.getByText("Sibling content", { exact: true })).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))
    await timeline.getByRole("button", { name: "Run command" }).click()
    await timeline.getByRole("button", { name: "Complete command" }).click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))
  })
}

// Moved from packages/app/e2e/regression/session-timeline-lifecycle-state.spec.ts
story("transitions a streaming shell from writing through command execution", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--streaming-shell-lifecycle")
  const tool = timeline.locator('[data-timeline-part-id="tool_shell_lifecycle"]')
  const title = tool.locator('[data-slot="basic-tool-tool-title"]')
  const shimmer = title.locator('[data-component="text-shimmer"]')
  const subtitle = tool.locator('[data-slot="basic-tool-tool-subtitle"]')
  await expect(shimmer).toHaveAttribute("aria-label", "Shell")
  await expect(shimmer).toHaveAttribute("data-active", "true")
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
  await timeline.getByRole("button", { name: "Run command" }).click()
  await expect(shimmer).toHaveAttribute("data-active", "true")
  await expect(subtitle).toHaveText("printf ready")
  await expect(tool).not.toContainText("Writing command...")
  await timeline.getByRole("button", { name: "Complete command" }).click()
  await expect(subtitle).toHaveText("printf ready")
})

// Moved from packages/app/e2e/regression/session-timeline-lifecycle-state.spec.ts
story("shimmers and expands a running shell command", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--streaming-shell-lifecycle")
  await timeline.getByRole("button", { name: "Run command" }).click()
  const tool = timeline.locator('[data-timeline-part-id="tool_shell_lifecycle"]')
  const trigger = tool.locator('[data-slot="collapsible-trigger"]')
  await expect(tool.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
  await expect(tool).not.toContainText("Writing command...")
  await expect(tool.locator('[data-component="shell-submessage"]')).toHaveText("printf ready")
  await expect(tool.locator('[data-component="shell-submessage"] [data-component="text-shimmer"]')).toHaveCount(0)
  await expect(trigger).toHaveCSS("height", "28px")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("still running")
})

// Moved from packages/app/e2e/regression/session-timeline-lifecycle-state.spec.ts
story("transitions thinking and hidden reasoning through busy to idle", async ({ mount }) => {
  const timeline = await mount("current-session-reasoning-projection--hidden-reasoning-lifecycle")
  const reasoning = timeline.locator('[data-timeline-part-id="msg_hidden_reasoning_lifecycle:reasoning:0"]')
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(timeline.getByText("Inspecting stability", { exact: true })).toBeVisible()
  await expect(reasoning).toHaveCount(0)
  await timeline.getByRole("button", { name: "Start shell" }).click()
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-part-id="tool_hidden_reasoning_shell"]')).toBeVisible()
  await timeline.getByRole("button", { name: "Finish session" }).click()
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(reasoning).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-lifecycle-state.spec.ts
story("moves busy through retry and recovery to final idle content", async ({ mount }) => {
  const timeline = await mount("current-session-reasoning-projection--retry-recovery-lifecycle")
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-row="DiffSummary"]')).toHaveCount(0)
  await timeline.getByRole("button", { name: "Retry request" }).click()
  await expect(timeline.locator('[data-timeline-row="Retry"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.getByRole("button", { name: "Recover request" }).click()
  await expect(timeline.locator('[data-timeline-row="Retry"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.getByRole("button", { name: "Finish response" }).click()
  await expect(timeline.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(timeline.locator('[data-timeline-part-id="msg_retry_recovery_lifecycle:text:0"]')).toContainText(
    "Recovered response",
  )
})

for (const profile of [
  { locale: "de", story: "completed-german", label: "Erkundung abgeschlossen" },
  { locale: "ar", story: "completed-arabic", label: "تم الاستكشاف" },
] as const) {
  // Moved from packages/app/e2e/regression/session-timeline-locale-projection.spec.ts
  story(`projects translated context status in ${profile.locale}`, async ({ mount, page }) => {
    const timeline = await mount(`current-session-context-projection--${profile.story}`)
    await timeline.getByRole("button", { name: "Complete read" }).click()
    await timeline.getByRole("button", { name: "Complete glob" }).click()
    const group = timeline.locator('[data-timeline-part-ids="tool_context_read,tool_context_glob"]')
    await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", profile.label)
    await expect(page.locator("html")).toHaveAttribute("lang", profile.locale)
  })
}
