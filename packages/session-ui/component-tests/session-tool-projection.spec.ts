import { expect, story } from "../../storybook/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders every admitted tool family and hides timeline-only exclusions", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--every-tool-family")
  await expect(
    timeline.locator('[data-timeline-part-ids="tool_family_read,tool_family_glob,tool_family_grep,tool_family_list"]'),
  ).toBeVisible()
  for (const id of [
    "webfetch",
    "websearch",
    "subagent",
    "shell",
    "edit",
    "write",
    "patch",
    "question",
    "skill",
    "custom",
  ]) {
    await expect(timeline.locator(`[data-timeline-part-id="tool_family_${id}"]`), id).toBeVisible()
  }
  const patch = timeline.locator('[data-timeline-part-id="tool_family_patch"]')
  await expect(patch.getByText("1 file", { exact: true })).toBeVisible()
  await expect(patch.getByRole("button", { name: "Patch 1 file", exact: true })).toHaveCount(0)
  await expect(patch.getByRole("button")).toHaveCount(1)
  await expect(patch.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "false")
  await expect(patch.locator('[data-slot="message-part-title-filename"]')).toHaveCount(0)
  await expect(patch.locator('[data-slot="message-part-actions"]')).toHaveCount(0)
  const edit = timeline.locator('[data-timeline-part-id="tool_family_edit"]')
  await expect(edit.locator('[data-component="apply-patch-tool"]')).toBeVisible()
  await expect(edit.locator('[data-slot="basic-tool-tool-title"]')).toContainText("Edit")
  await expect(timeline.locator('[data-timeline-part-id="tool_family_todo"]')).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("renders every tool error outcome without leaking hidden tools", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--every-tool-error")
  const names = ["shell", "edit", "write", "patch", "webfetch", "websearch", "subagent", "skill", "mcp_probe"]
  await expect(timeline.locator('[data-kind="tool-error-card"]')).toHaveCount(names.length + 1)
  await expect(timeline.locator('[data-timeline-part-id="tool_error_question_dismissed"]')).toContainText(/dismissed/i)
  await expect(timeline.locator('[data-timeline-part-id="tool_error_todo"]')).toHaveCount(0)
  for (const name of names) await expect(timeline.locator(`[data-timeline-part-id="tool_error_${name}"]`)).toBeVisible()
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("transitions shell and question through running error outcomes", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--running-tool-errors")
  const shell = timeline.locator('[data-timeline-part-id="tool_transition_shell"]')
  const question = timeline.locator('[data-timeline-part-id="tool_transition_question"]')
  await expect(shell).toBeVisible()
  await expect(question).toHaveCount(0)
  await timeline.getByRole("button", { name: "Fail running tools" }).click()
  await expect(shell.locator('[data-kind="tool-error-card"]')).toBeVisible()
  await expect(shell).toContainText("Command exited 1")
  await expect(question).toContainText(/dismissed/i)
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels all web search provider variants", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--search-providers")
  await expect(timeline.getByRole("button", { name: /Parallel Web Search/ })).toBeVisible()
  await expect(timeline.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  await expect(timeline.getByRole("button", { name: /^Web Search/ })).toBeVisible()
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels completed searches with result counts", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--context-labels")
  const group = timeline.locator('[data-timeline-part-ids="tool_label_glob,tool_label_grep,tool_label_read"]')
  await group.locator('[data-slot="collapsible-trigger"]').click()
  const rows = group.locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
  await expect(rows.filter({ hasText: "Glob" })).toContainText("(1 match)")
  await expect(rows.filter({ hasText: "Grep" })).toContainText("(12 matches)")
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels read tools from their path input", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--context-labels")
  const group = timeline.locator('[data-timeline-part-ids="tool_label_glob,tool_label_grep,tool_label_read"]')
  await group.locator('[data-slot="collapsible-trigger"]').click()
  await expect(
    group
      .locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
      .filter({ hasText: "Read" }),
  ).toContainText("a.ts")
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels skill tools from IDs and result metadata", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--skill-labels")
  for (const [id, name] of [
    ["tool_skill_id", "frontend-design"],
    ["tool_skill_name", "OpenCode"],
  ] as const) {
    const skill = timeline.locator(`[data-timeline-part-id="${id}"]`)
    const loaded = skill.locator('[data-component="tool-loaded-item"]')
    await expect(loaded).toHaveAttribute("aria-label", `Loaded ${name} skill`)
    await expect(loaded).toHaveCSS("line-height", "16px")
    await expect(loaded.locator('[data-slot="tool-loaded-label"]')).toHaveText("Loaded")
    await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveText("skill")
    await expect(loaded.locator('[data-component="text-shimmer"]')).toHaveAttribute("aria-label", name)
  }
})

// Moved from packages/app/e2e/regression/session-timeline-reducer-projection.spec.ts
story("groups singleton and separated context operations at correct boundaries", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--context-boundaries")
  await expect(timeline.locator('[data-timeline-part-ids="tool_boundary_read"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-part-ids="tool_boundary_glob,tool_boundary_grep"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-part-ids="tool_boundary_list"]')).toBeVisible()
  await expect(timeline.locator('[data-timeline-row="AssistantPart"]')).toHaveCount(5)
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("combines adjacent edit calls and repeated files into one group", async ({ mount }) => {
  const timeline = await mount("current-session-tool-projection--grouped-edits")
  const group = timeline.locator('[data-timeline-part-ids="tool_grouped_edit_first,tool_grouped_edit_second"]')
  await expect(group.locator('[data-slot="basic-tool-tool-title"]')).toContainText("Edit")
  await expect(group.getByText("1 file", { exact: true })).toBeVisible()
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
  await expect(group.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
})
