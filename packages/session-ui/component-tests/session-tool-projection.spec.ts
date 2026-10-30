import { expect, story } from "../../stories/playwright/story"

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders every admitted tool family and hides timeline-only exclusions", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "workflow" } })

  const first = timeline.locator(
    '[data-timeline-part-ids="tool_family_read,tool_family_glob,tool_family_grep,tool_family_list,tool_family_webfetch,tool_family_websearch,tool_family_subagent,tool_family_shell,tool_family_edit,tool_family_write,tool_family_write_extra,tool_family_patch"]',
  )

  const second = timeline.locator('[data-timeline-part-ids="tool_family_skill,tool_family_custom"]')
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()
  await first.getByRole("button").click()
  await second.getByRole("button").click()

  for (const id of ["webfetch", "websearch", "subagent", "shell", "question", "skill", "custom"]) {
    await expect(timeline.locator(`[data-timeline-part-id="tool_family_${id}"]`), id).toBeVisible()
  }

  const files = timeline.locator(
    '[data-timeline-part-ids="tool_family_edit,tool_family_write,tool_family_write_extra,tool_family_patch"]',
  )

  await expect(files).toBeVisible()
  await expect(files.locator('[data-scope="apply-patch"]')).toHaveCount(1)
  await expect(files.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "new.ts", "extra.ts"])
  await expect(files.locator('[data-slot="basic-tool-tool-title"]')).toHaveCount(0)
  await expect(files.locator('[data-scope="apply-patch"] button')).toHaveCount(3)
  await expect(files.locator('[data-scope="apply-patch"] button[aria-expanded="false"]')).toHaveCount(3)
  await expect(timeline.locator('[data-timeline-part-id="tool_family_todo"]')).toHaveCount(0)
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("renders every tool error outcome without leaking hidden tools", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "failures" } })
  const names = ["shell", "edit", "write", "patch", "webfetch", "websearch", "subagent", "skill", "mcp_probe"]
  const group = timeline.locator(`[data-timeline-part-ids="${names.map((name) => `tool_error_${name}`).join(",")}"]`)
  await expect(group.getByRole("button")).toHaveAccessibleName(/^Used 9 /)
  await group.getByRole("button").click()
  await expect(timeline.locator('[data-kind="tool-error-card"]')).toHaveCount(names.length + 1)
  const dismissed = timeline.locator('[data-timeline-part-id="tool_error_question_dismissed"]')
  await expect(dismissed.getByText(/dismissed/i)).toBeVisible()
  await expect(dismissed).toContainText(/dismissed/i)
  await expect(timeline.locator('[data-timeline-part-id="tool_error_todo"]')).toHaveCount(0)

  for (const name of names) await expect(timeline.locator(`[data-timeline-part-id="tool_error_${name}"]`)).toBeVisible()
})

story("lists a failed execute's calls and keeps its error under the failed call", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-failed")
  await timeline.getByRole("button", { name: /^Used 5 / }).click()
  const failed = timeline.locator('[data-timeline-part-id="tool_execute_failed_url"]')
  const call = failed.locator('[data-slot="execute-tool-call"]')
  // Executions open by default, so the calls show without expanding the row.
  await expect(call).toHaveText([/browser\.tabs\.open/])
  await expect(call).toHaveAttribute("data-status", "error")
  await expect(timeline.locator('[data-kind="tool-error-card"]')).toHaveCount(0)

  // The runtime error stays collapsed under the failed call until it is expanded.
  const error = failed.locator('[data-slot="execute-tool-error"]')
  await expect(error).toHaveCount(0)
  await call.click()
  await expect(call).toHaveAttribute("aria-expanded", "true")
  await expect(failed.locator('[data-slot="execute-tool-call-input"]')).toContainText(
    "url:file:///C:/tmp/opencode/throne-of-glass-luke.html",
  )
  await expect(error).toContainText(
    "The connected server must be able to reach the address; localhost refers to that server.",
  )
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("transitions shell and question through running error outcomes", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "transition" } })
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
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "providers" } })
  await timeline.getByRole("button", { name: "Used 3 Parallel Web Search, Exa Web Search, Web Search" }).click()
  const tools = timeline.locator('[data-component="context-tool-group-list"]')
  await expect(tools.getByRole("button", { name: /Parallel Web Search/ })).toBeVisible()
  await expect(tools.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  await expect(tools.getByRole("button", { name: /^Web Search/ })).toBeVisible()
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels completed searches with result counts", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "results" } })
  const group = timeline.locator('[data-timeline-part-ids="tool_label_glob,tool_label_grep,tool_label_read"]')
  await group.locator('[data-slot="collapsible-trigger"]').click()
  const rows = group.locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
  await expect(rows.filter({ hasText: "Glob" })).toContainText("(1 match)")
  await expect(rows.filter({ hasText: "Grep" })).toContainText("(12 matches)")
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels read tools from their path input", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "read" } })
  const group = timeline.locator('[data-timeline-part-ids="prt_read_path"]')
  await group.locator('[data-slot="collapsible-trigger"]').click()
  await expect(
    group
      .locator('[data-component="context-tool-group-list"] [data-component="tool-trigger"]')
      .filter({ hasText: "Read" }),
  ).toContainText("a.ts")
})

// Moved from packages/app/e2e/regression/session-timeline-tool-projection.spec.ts
story("labels skill tools from IDs and result metadata", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "skills" } })
  const group = timeline.locator('[data-timeline-part-ids="tool_skill_id,tool_skill_name"]')
  await expect(group.getByRole("button")).toHaveAccessibleName("Used 2 Skill")
  await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
    "aria-label",
    "Used 2 Skill",
  )
  await group.getByRole("button").click()
  const loaded = group.locator('[data-component="tool-loaded-item"]')
  await expect(loaded).toHaveCount(1)
  await expect(loaded).toHaveAttribute("aria-label", "Loaded frontend-design, OpenCode skills")
  await expect(loaded).toHaveCSS("line-height", "16px")
  await expect(loaded.locator('[data-slot="tool-loaded-label"]')).toHaveText("Loaded")
  await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveText("skills")
  const names = loaded.locator('[data-component="text-shimmer"]')
  await expect(names).toHaveCount(2)
  await expect(names.nth(0)).toHaveAttribute("aria-label", "frontend-design")
  await expect(names.nth(1)).toHaveAttribute("aria-label", "OpenCode")
})

// Moved from packages/app/e2e/regression/session-timeline-reducer-projection.spec.ts
story("groups every collapsed tool until visible text separates the stack", async ({ mount }) => {
  const timeline = await mount("current-session-research-agents--agent-research", { args: { scenario: "steps" } })
  await expect(timeline.locator('[data-timeline-part-ids="tool_boundary_read"]')).toBeVisible()

  const group = timeline.locator(
    '[data-timeline-part-ids="tool_boundary_glob,tool_boundary_grep,tool_boundary_shell,tool_boundary_list"]',
  )

  await expect(group).toBeVisible()
  await expect(group.getByRole("button")).toHaveAccessibleName("Used 4 Glob, Grep, Shell, List")
  await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
    "aria-label",
    "Used 4 Glob, Grep, Shell, List",
  )
  await expect(timeline.locator('[data-timeline-row="AssistantPart"]')).toHaveCount(3)
  await expect(timeline.locator('[data-timeline-spacing="content"]')).toHaveCount(2)
  await expect(timeline.locator('[data-timeline-spacing="content"]').nth(0)).toHaveCSS("padding-top", "16px")
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("combines adjacent edit calls and repeated files into one group", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "repeated" } })
  const group = timeline.locator('[data-timeline-part-ids="tool_grouped_edit_first,tool_grouped_edit_second"]')
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
  await expect(group.locator('[data-scope="apply-patch"] button')).toContainText("+2")
  await expect(group.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
})

story("opens an execution's code and output from its View code action", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-code")
  await timeline.getByRole("button", { name: "View code" }).first().click()
  const dialog = timeline.page().getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Execute" })).toBeVisible()
  await expect(dialog).toContainText("Completed")
  await expect(dialog).toContainText("2 calls")
  await expect(dialog).toContainText('const tab = await tools.browser.tabs.open({ url: "http://localhost:4399" })')
  await expect(dialog).toContainText('"tab": "tab_4f1c"')
  await expect(dialog.getByRole("button", { name: "Copy code" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Copy output" })).toBeVisible()
})

story("wraps execute details code, pads it evenly, and starts line numbers near the block edge", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-code")
  const tool = timeline.locator('[data-timeline-part-id="tool_execute_long_call"]')
  await tool.hover()
  await tool.getByRole("button", { name: "View code" }).click()
  const source = timeline.page().getByRole("dialog").locator('[data-slot="execute-details-source"]').first()
  await expect(source.locator("[data-column-number]").first()).toBeVisible()

  const layout = await source.evaluate((element) => {
    const root = element.querySelector("diffs-container")!.shadowRoot!
    const code = root.querySelector<HTMLElement>("[data-code]")!
    const number = root.querySelector("[data-line-number-content]")!
    const lines = [...root.querySelectorAll("[data-line]")].map((line) => line.getBoundingClientRect())
    const box = element.getBoundingClientRect()
    return {
      paddingTop: lines[0].top - box.top,
      paddingBottom: box.bottom - lines.at(-1)!.bottom,
      // A horizontally scrolling block reserves a scrollbar track under a single line.
      overflow: code.scrollWidth - code.clientWidth,
      numberStart: number.getBoundingClientRect().left - box.left,
    }
  })

  expect(layout.overflow).toBe(0)
  expect(layout.numberStart).toBe(12)
  expect(layout.paddingTop).toBe(4)
  expect(layout.paddingBottom).toBe(4)
})

story("reveals the View code action while hovering anywhere over the execution", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-code")
  const tool = timeline.locator('[data-timeline-part-id="tool_execute_long_call"]')
  const action = tool.locator('[data-slot="basic-tool-action"]')
  await timeline.page().mouse.move(0, 0)
  await expect(action).toHaveCSS("opacity", "0")

  // The calls sit below the header, so hovering them proves the whole tool reveals the action.
  await tool.locator('[data-slot="execute-tool-call"]').first().hover()
  await expect(action).toHaveCSS("opacity", "1")

  await timeline.page().mouse.move(0, 0)
  await expect(action).toHaveCSS("opacity", "0")
})

story("keeps long execute calls inside the tool and shows the script output", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-code")
  const tool = timeline.locator('[data-timeline-part-id="tool_execute_long_call"]')
  const calls = tool.locator('[data-component="execute-tool-calls"]')
  const rows = calls.locator('[data-slot="execute-tool-call"]')
  await expect(rows).toHaveText([/mesh\.exec/, /Output\s*3 lines/])

  // The script output stays collapsed until its row is expanded.
  const result = calls.locator('[data-slot="bash-result"]')
  await expect(result).toHaveCount(0)
  const top = await rows.first().evaluate((element) => element.getBoundingClientRect().top)
  await rows.nth(1).click()
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true")
  await expect(result).toContainText("Cleanup finished on blade")
  // Opening the output must not move the rows above it.
  expect(await rows.first().evaluate((element) => element.getBoundingClientRect().top)).toBe(top)

  const overflow = await tool.evaluate((element) => {
    const calls = element.querySelector('[data-component="execute-tool-calls"]')

    if (!calls) return Number.NaN

    return calls.getBoundingClientRect().right - element.getBoundingClientRect().right
  })

  expect(overflow).toBeLessThanOrEqual(0)
})

story("shows a failed execution's error in place of its output", async ({ mount }) => {
  const timeline = await mount("current-session-terminal-work--execute-failed")
  await timeline.getByRole("button", { name: /^Used 5 / }).click()
  await timeline
    .locator('[data-timeline-part-id="tool_execute_failed_url"]')
    .getByRole("button", { name: "View code" })
    .click()
  const dialog = timeline.page().getByRole("dialog")
  await expect(dialog).toContainText("Failed")
  await expect(dialog).toContainText("Invalid browser URL.")
  await expect(dialog.getByRole("button", { name: "Copy error" })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Copy output" })).toHaveCount(0)
})
