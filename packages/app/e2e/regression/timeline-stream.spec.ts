import { expect, test, type Locator, type Page } from "@playwright/test"
import type { SessionMessageAssistant, SessionMessageInfo, ShellInfo } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createTwoFilesPatch } from "diff"
import {
  assistantID,
  assistantMessage,
  compactionDelta,
  compactionEnded,
  compactionFailed,
  compactionStarted,
  completedAssistantInfo,
  directory,
  inboxDelivered,
  inboxEnqueued,
  messageUpdated,
  partUpdated,
  reasoningPart,
  renderedPartID,
  session,
  sessionID,
  setupTimeline,
  shell,
  status,
  stepStarted,
  textPart,
  toolPart,
  userMessage,
  userText,
} from "../utils/timeline"

const detailed = timelinePresets[2].value

const user = { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } } satisfies SessionMessageInfo

const completed = {
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [{ type: "text", text: "Working" }],
  time: { created: 2, completed: 3 },
} satisfies SessionMessageAssistant

test.describe("static projection", () => {
  test("renders current protocol notices in CLI order", async ({ page }) => {
    const ownerWarnings: string[] = []
    page.on("console", (message) => {
      if (message.text().includes("computations created outside a `createRoot` or `render`"))
        ownerWarnings.push(message.text())
    })
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, notices: { placement: "separate" } } },
      sessionMessages: [
        user,
        { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 2 } },
        completed,
        {
          id: "msg_subagent",
          type: "synthetic",
          text: "done",
          description: "Search code",
          metadata: { source: "subagent", agent: "explore", state: "completed" },
          time: { created: 4 },
        },
        {
          id: "msg_restart",
          type: "synthetic",
          text: "continue",
          description: "Continuing after restart",
          time: { created: 5 },
        },
        { id: "msg_skill", type: "skill", skill: "review", name: "Review", text: "instructions", time: { created: 6 } },
      ],
    })

    const notices = page.locator('[data-slot="session-timeline-notice"]')
    await expect(notices).toHaveCount(4)
    await expect(notices.nth(0)).toHaveText(/^Agent changed\s*Explore$/)
    await expect(notices.nth(1)).toContainText("Explore finished · Search code")
    await expect(notices.nth(2)).toContainText("Continuing after restart")
    await expect(notices.nth(3)).toContainText("Skill · Review")
    await expect(notices).toHaveClass([
      /text-v2-text-text-faint/,
      /text-v2-text-text-faint/,
      /text-v2-text-text-faint/,
      /text-v2-text-text-faint/,
    ])
    await expect(notices.locator(".text-v2-text-text-base")).toHaveCount(0)
    expect(ownerWarnings).toEqual([])
  })

  test("projects gaps, dividers, assistant parts, and errors together", async ({ page }) => {
    const firstUser = userMessage(
      [
        userText("Keep this stable", { id: "prt_comment" }),
        userText("Continue after the comment", { id: "prt_visible_user" }),
      ],
      { summary: { diffs: Array.from({ length: 11 }, (_, index) => summaryDiff(index)) } },
    )

    const aborted = assistantMessage([{ id: "prt_before_abort", type: "text", text: "Before interruption" }], {
      id: "msg_1001_assistant_aborted",
      error: { type: "MessageAbortedError", message: "Stopped" },
    })

    const failed = assistantMessage([{ id: "prt_after_abort", type: "text", text: "After interruption" }], {
      id: "msg_1002_assistant_failed",
      error: { type: "APIError", message: "Visible provider failure" },
      created: 1700000003000,
    })

    const nextUser = userMessage([userText("Second turn", { id: "prt_second_user" })], {
      id: "msg_2000_second_user",
      created: 1700000005000,
    })

    const nextAssistant = assistantMessage([{ id: "prt_second_text", type: "text", text: "Second response" }], {
      id: "msg_2001_second_assistant",
      parentID: "msg_2000_second_user",
      created: 1700000006000,
    })

    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      messages: [firstUser, aborted, failed, nextUser, nextAssistant],
    })

    await timeline.send(status("idle"))
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = 0))

    await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
    await expect(page.getByText("Before interruption", { exact: true })).toBeVisible()
    await expect(page.getByText("Visible provider failure")).toBeVisible()
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()
  })

  test("does not repeat a review comment file as an attachment", async ({ page }) => {
    const message = userMessage([
      userText("what's goin on here", { id: "prt_user_review_comment" }),
      {
        id: "prt_user_review_file",
        type: "file",
        mime: "text/plain",
        filename: "LiveRuntime.ts",
        url: "file:///repo/LiveRuntime.ts?start=14&end=32",
      },
      {
        id: "prt_user_unrelated_file",
        type: "file",
        mime: "text/plain",
        filename: "notes.txt",
        url: "data:text/plain;base64,bm90ZXM=",
      },
    ])

    message.metadata = {
      displayText: "what's goin on here",
      comments: [
        {
          path: "LiveRuntime.ts",
          comment: "what's goin on here",
          selection: { startLine: 14, startChar: 0, endLine: 32, endChar: 0 },
          origin: "review",
        },
      ],
    }
    await setupTimeline(page, { messages: [message, assistantMessage()] })

    const row = page.locator('[data-component="user-message"]')
    await expect(row.getByText("LiveRuntime.ts:14-32", { exact: true })).toBeVisible()
    const attachments = row.locator('[data-slot="user-message-attachments"]')
    await expect(attachments.getByText("LiveRuntime.ts", { exact: true })).toHaveCount(0)
    await expect(attachments.getByText("notes.txt", { exact: true })).toBeVisible()
  })

  test("groups instruction files loaded by the same read", async ({ page }) => {
    const id = "prt_read_instructions"
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, tools: { placement: "separate" } } },
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            id,
            "read",
            "completed",
            { path: "src/a.ts" },
            { metadata: { loaded: ["AGENTS.md", "packages/app/AGENTS.md", "packages/ui/AGENTS.md"] } },
          ),
        ]),
      ],
    })

    const loaded = page.locator(`[data-timeline-part-id="${id}"] [data-component="tool-loaded-item"]`)
    await expect(loaded).toHaveCount(1)
    await expect(loaded).toHaveAttribute(
      "aria-label",
      "Loaded AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md",
    )
    await expect(loaded.locator('[data-slot="tool-loaded-value"]')).toHaveText(
      "AGENTS.md, packages/app/AGENTS.md, packages/ui/AGENTS.md",
    )
    await expect(loaded.locator('[data-slot="tool-loaded-kind"]')).toHaveCount(0)
  })

  test("groups only consecutive successful skill tools", async ({ page }) => {
    const parts = [
      toolPart("prt_skill_first", "skill", "completed", { id: "ocpr" }),
      toolPart("prt_skill_second", "skill", "completed", { id: "effect" }),
      toolPart("prt_skill_third", "skill", "completed", { id: "ui-pr-screenshots" }),
      toolPart("prt_skill_break", "read", "completed", { path: "src/a.ts" }),
      toolPart("prt_skill_last", "skill", "completed", { id: "opencode" }),
    ]

    await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      messages: [userMessage(), assistantMessage(parts)],
    })

    const group = page.locator(`[data-timeline-part-ids="${parts.map((part) => part.id).join(",")}"]`)
    await group.getByRole("button").click()
    const loaded = group.locator('[data-component="tool-loaded-item"]')
    await expect(loaded).toHaveCount(2)
    await expect(loaded.nth(0)).toHaveAttribute("aria-label", "Loaded ocpr, effect, ui-pr-screenshots skills")
    await expect(loaded.nth(1)).toHaveAttribute("aria-label", "Loaded opencode skill")
  })

  test("leaves tools expanded by settings outside the collapsed stack", async ({ page }) => {
    const parts = [
      shell("prt_expanded_shell", "completed", "expanded"),
      toolPart("prt_collapsed_patch", "patch", "completed", { patchText: "Update src/value.ts" }),
      toolPart("prt_collapsed_read", "read", "completed", { path: "src/value.ts" }),
    ]

    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(parts)],
      settings: { shellToolPartsExpanded: true },
    })

    await expect(page.locator('[data-timeline-part-id="prt_expanded_shell"]')).toBeVisible()
    const group = page.locator('[data-timeline-part-ids="prt_collapsed_patch,prt_collapsed_read"]')
    await expect(group.getByRole("button", { name: "Used 2 Patch, Read", exact: true })).toBeVisible()
    await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
      "aria-label",
      "Used 2 Patch, Read",
    )
    await expect(page.locator('[data-timeline-spacing="tool"]')).toHaveCSS("padding-top", "8px")
  })
})

test("combines adjacent patch calls and repeated files into one group", async ({ page }) => {
  const [first, second] = ["prt_patch_first", "prt_patch_second"]

  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: { ...detailed, edit: { placement: "separate", details: "collapsed" } } },
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          first,
          "patch",
          "completed",
          { patchText: "Update src/first.ts" },
          { metadata: { files: [patchFile("src/first.ts", "modified")] } },
        ),
      ]),
    ],
  })

  const initial = page.locator(`[data-timeline-part-id="${first}"]`)
  const initialFile = initial.locator('[data-scope="apply-patch"] [data-type="update"]')
  await expect(initialFile.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await initialFile.getByRole("button").click()
  await expect(initialFile.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await initial.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")

    if (row) row.dataset.patchRow = "stable"
  })

  await timeline.send(partUpdated(toolPart(second, "patch", "running", { patchText: "Update more files" })))
  const group = page.locator(`[data-timeline-part-ids="${first},${second}"]`)
  const row = group.locator("xpath=ancestor::*[@data-timeline-key]")
  const updated = group.locator('[data-scope="apply-patch"] [data-type="update"] button')
  await expect(row).toHaveAttribute("data-patch-row", "stable")
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts"])
  await expect(updated).toHaveAttribute("aria-expanded", "true")

  await timeline.send(
    partUpdated(
      toolPart(
        second,
        "patch",
        "completed",
        { patchText: "Update more files" },
        { metadata: { files: [patchFile("src/first.ts", "modified"), patchFile("src/second.ts", "added")] } },
      ),
    ),
  )
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["first.ts", "second.ts"])
  await expect(updated).toHaveAttribute("aria-expanded", "true")
  await expect(group.locator('[data-scope="apply-patch"] [data-type="add"] button')).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(page.locator(`[data-timeline-part-id="${first}"], [data-timeline-part-id="${second}"]`)).toHaveCount(0)
})

test("keeps a failed patch in Used without losing the surviving file choice", async ({ page }) => {
  const failed = "prt_grouped_patch_failed"
  const surviving = "prt_grouped_patch_surviving"

  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: detailed },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(failed, "patch", "running", { patchText: "Update src/failed.ts" }),
          toolPart(
            surviving,
            "patch",
            "running",
            { patchText: "Update src/surviving.ts" },
            { metadata: { files: [patchFile("src/surviving.ts", "modified")] } },
          ),
        ],
        { completed: false },
      ),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await used.click()
  const file = group.locator('[data-scope="apply-patch"] button')
  await expect(file).toHaveAttribute("aria-expanded", "false")
  await file.click()
  await expect(file).toHaveAttribute("aria-expanded", "true")
  await group.evaluate((element) => {
    const row = element.closest<HTMLElement>("[data-timeline-key]")

    if (row) row.dataset.groupIdentity = "preserved"
  })

  await timeline.send(
    partUpdated(
      toolPart(failed, "patch", "error", { patchText: "Update src/failed.ts" }, { error: "Patch failed visibly" }),
    ),
  )

  const failedRow = page.locator("[data-timeline-key]", { has: page.locator(`[data-timeline-part-id="${failed}"]`) })

  const survivingRow = page.locator("[data-timeline-key]", {
    has: page.locator(`[data-timeline-part-id="${surviving}"]`),
  })

  await expect(group).toHaveAttribute("data-timeline-part-ids", `${failed},${surviving}`)
  await expect(used).toHaveAttribute("aria-expanded", "true")
  await expect(failedRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await expect(survivingRow).toHaveAttribute("data-timeline-key", /^assistant-part:context:/)
  await group.locator(`[data-timeline-part-id="${failed}"] [data-slot="collapsible-trigger"]`).click()
  await expect(failedRow.getByText("Patch failed visibly")).toBeVisible()
  await expect(survivingRow).toHaveAttribute("data-group-identity", "preserved")
  await expect(survivingRow.locator('[data-scope="apply-patch"] button')).toHaveAttribute("aria-expanded", "true")
})

test("does not remount an edit diff when a sibling part arrives", async ({ page }) => {
  const editID = "prt_0001_edit"
  await page.addInitScript(() => {
    let count = 0
    const attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      count += 1

      return attachShadow.call(this, init)
    }

    // SAFETY: this init script owns `__shadowRoots`; the probe reads below run only after it installed it.
    const probe = window as Window & { __shadowRoots?: { reset(): void; count(): number } }

    probe.__shadowRoots = {
      reset: () => {
        count = 0
      },
      count: () => count,
    }
  })

  const timeline = await setupTimeline(page, {
    settings: { editToolPartsExpanded: true, shellToolPartsExpanded: true, showReasoningSummaries: true },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(
            editID,
            "edit",
            "completed",
            {
              path: "src/regression.ts",
              oldString: "export const value = 'before'",
              newString: "export const value = 'after'",
            },
            {
              output: "Edited src/regression.ts",
              title: "src/regression.ts",
              metadata: {
                files: [
                  {
                    file: "src/regression.ts",
                    patch: createTwoFilesPatch(
                      "a/src/regression.ts",
                      "b/src/regression.ts",
                      "export const value = 'before'\n",
                      "export const value = 'after'\n",
                    ),
                    additions: 1,
                    deletions: 1,
                    status: "modified",
                  },
                ],
              },
            },
          ),
        ],
        { completed: false },
      ),
    ],
  })

  const tool = page.locator(`[data-timeline-part-id="${editID}"]`)
  await expect(tool.locator('[data-component="file"][data-mode="diff"]')).toBeVisible()

  const markers = () =>
    tool.evaluate((element) => {
      const nodes = [
        element,
        element.querySelector('[data-component="file"][data-mode="diff"]'),
        element.closest("[data-timeline-key]"),
        element.closest("[data-timeline-row]"),
      ]

      return {
        markers: nodes.map((node) => (node instanceof HTMLElement ? node.dataset.timelineProbe : undefined)),
        // SAFETY: the init script installed `__shadowRoots` before the page loaded.
        shadowRoots: (window as Window & { __shadowRoots?: { count(): number } }).__shadowRoots!.count(),
      }
    })

  await tool.evaluate((element) => {
    ;[
      element,
      element.querySelector('[data-component="file"][data-mode="diff"]'),
      element.closest("[data-timeline-key]"),
      element.closest("[data-timeline-row]"),
    ].forEach((node) => {
      if (!(node instanceof HTMLElement)) throw new Error("missing edit tool, diff, row, or frame")
      node.dataset.timelineProbe = "before"
    })

    // SAFETY: the init script installed `__shadowRoots` before the page loaded.
    const probe = window as Window & { __shadowRoots?: { reset(): void } }

    probe.__shadowRoots!.reset()
  })

  await timeline.send(partUpdated(textPart("prt_sibling_text", "Streaming added a later assistant text part.")))
  await timeline.waitForPart("prt_sibling_text")
  expect(await markers()).toEqual({ markers: ["before", "before", "before", "before"], shadowRoots: 0 })
})

for (const transition of ["reasoning-end", "idle", "retry"] as const) {
  test(`stops active Thinking on ${transition} without a following tool`, async ({ page }) => {
    const id = `prt_reasoning_stop_${transition}`
    const text = "## Inspecting stability\n\nThe timeline is ready for the next step."

    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([reasoningPart(id, text)], { completed: false })],
      settings: { timelineDetail: { ...detailed, thinking: { placement: "separate", details: "collapsed" } } },
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

// Separate placement keeps each part standalone, so the user's disclosure choice must survive completion.
for (const shellDefault of ["collapsed", "expanded"] as const) {
  test(`keeps separate shell and reasoning disclosure through completion from the ${shellDefault} shell default`, async ({
    page,
  }) => {
    const reasoningID = `prt_separate_reasoning_${shellDefault}`
    const shellID = `prt_separate_shell_${shellDefault}`
    const output = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
    const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })

    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistant],
      settings: {
        timelineDetail: {
          ...detailed,
          thinking: { placement: "separate", details: "collapsed" },
          shell: { placement: "separate", details: shellDefault },
        },
      },
    })

    const thought = page.locator(
      `[data-timeline-part-id="${renderedPartID(reasoningID)}"] [data-slot="collapsible-trigger"]`,
    )

    const shellTrigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
    const group = page.locator('[data-component="collapsed-tool-group"]')
    // One row opens the thought, the other opens and then closes it again.
    const thoughtOpen = shellDefault === "collapsed"
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(thought).toHaveAttribute("aria-expanded", "false")
    await thought.click()

    if (!thoughtOpen) await thought.click()
    await expect(thought).toHaveAttribute("aria-expanded", String(thoughtOpen))

    await timeline.send(partUpdated(shell(shellID, "running", output(3))))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(group).toHaveCount(0)
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault === "expanded"))
    await shellTrigger.click()
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault !== "expanded"))

    await timeline.send(partUpdated(shell(shellID, "completed", output(6))))
    await timeline.send(partUpdated(textPart(`prt_separate_sibling_${shellDefault}`, "Sibling content")))
    await timeline.send(messageUpdated(completedAssistantInfo(assistant)))
    await timeline.send(status("idle"))
    await expect(page.getByText("Sibling content", { exact: true })).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${shellID}"] [data-component="text-shimmer"]`)).toHaveAttribute(
      "data-active",
      "false",
    )
    await expect(group).toHaveCount(0)
    await expect(shellTrigger).toHaveAttribute("aria-expanded", String(shellDefault !== "expanded"))
    await expect(thought).toHaveAttribute("aria-expanded", String(thoughtOpen))
  })
}

test("shows a background subagent's outcome as its own row where it finished", async ({ page }) => {
  const childID = "ses_background_outcome"
  const after = assistantMessage([], { id: "msg_after", completed: false })

  const timeline = await setupTimeline(page, {
    sessionMessages: [
      user,
      {
        id: "msg_launch",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_background",
            name: "subagent",
            state: {
              status: "completed",
              input: { description: "Map the inbox", agent: "explore", background: true },
              content: [{ type: "text", text: "working" }],
              metadata: { sessionID: childID, status: "running" },
            },
            time: { created: 2, completed: 3 },
          },
          {
            type: "tool",
            id: "call_read_before",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "README.md" },
              content: [{ type: "text", text: "ok" }],
              metadata: {},
            },
            time: { created: 2, completed: 3 },
          },
        ],
        time: { created: 2, completed: 3 },
      },
    ],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Map the inbox" })],
  })

  await expect(page.getByText(/^Used\s*1\s*Read$/)).toBeVisible()

  await timeline.send([
    inboxEnqueued({
      sessionID,
      inboxID: "msg_outcome",
      item: {
        type: "synthetic",
        payload: {
          text: '<subagent state="completed">done</subagent>',
          description: "Map the inbox",
          metadata: { source: "subagent", childID, agent: "explore", state: "completed" },
        },
        delivery: "steer",
      },
    }),
    inboxDelivered({ sessionID, inboxID: "msg_outcome" }),
    stepStarted(after),
    ...partUpdated({
      ...toolPart("call_read_after", "read", "completed", { filePath: "AGENTS.md" }),
      messageID: after.id,
    }),
    messageUpdated(completedAssistantInfo(after)),
  ])

  // The outcome sits between the work before and after it instead of folding into either group.
  const notice = page.locator('[data-slot="session-timeline-notice"]')
  await expect(page.getByText(/^Used\s*1\s*Read$/).or(notice)).toHaveText([
    /^Used\s*1\s*Read$/,
    /^Explore finished · Map the inbox$/,
    /^Used\s*1\s*Read$/,
  ])
  await expect(notice).toHaveAttribute("data-outcome", "completed")

  await expect(notice.locator('[data-slot="icon-svg"]')).toHaveCount(0)
  await notice.click()
  await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
})

test("holds undelivered input still while live status above it comes and goes", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    sessionStatus: { [sessionID]: { type: "busy" } },
    messages: [
      userMessage(),
      // Streaming text stands in for Working, so live status has nothing to show.
      assistantMessage([textPart("prt_streaming_answer", "It ships as soon as it's ready.")], { completed: false }),
    ],
  })

  const answer = page.getByText("It ships as soon as it's ready.", { exact: true })
  const working = page.locator('[data-component="session-working"]')
  const activity = page.locator('[data-timeline-key="activity"]')
  const lane = async () => (await activity.boundingBox())?.height

  const outcome = (id: string, description: string) =>
    inboxEnqueued({
      sessionID,
      inboxID: id,
      item: {
        type: "synthetic",
        payload: {
          text: '<subagent state="completed">done</subagent>',
          description,
          metadata: { source: "subagent", agent: "general", state: "completed" },
        },
        delivery: "steer",
      },
    })

  const first = page.locator('[data-slot="session-timeline-notice"]').filter({ hasText: "Audit constraints" })

  const gap = async () => {
    const [above, below] = await Promise.all([answer.boundingBox(), first.boundingBox()])

    return above && below ? Math.round(below.y - above.y - above.height) : undefined
  }

  await expect(answer).toBeVisible()
  await timeline.send(outcome("msg_pending_outcome", "Audit constraints"))
  await expect(first).toHaveText(/^General finished · Audit constraints$/)
  await expect(working).toHaveCount(0)
  // Live status moves above the waiting notice, but takes no room while it has nothing to show.
  await expect.poll(lane).toBe(0)
  const pending = await gap()

  await timeline.send(inboxDelivered({ sessionID, inboxID: "msg_pending_outcome" }))
  await expect(activity).toHaveCount(0)
  await expect.poll(gap).toBe(pending)

  await timeline.send(outcome("msg_pending_review", "Review copy"))
  await expect(page.locator('[data-slot="session-timeline-notice"]').filter({ hasText: "Review copy" })).toBeVisible()
  await expect.poll(lane).toBe(0)

  // A finished read keeps Working on; the next streaming text hides it again. Once shown, the lane stays.
  await timeline.send(partUpdated(toolPart("prt_live_read", "read", "completed", { filePath: "README.md" })))
  await expect(working).toBeVisible()
  await expect.poll(lane).toBe(36)
  await timeline.send(partUpdated(textPart("prt_live_text", "Checking the copy next.")))
  await expect(page.getByText("Checking the copy next.", { exact: true })).toBeVisible()
  await expect(working).toHaveCount(0)
  await expect.poll(lane).toBe(36)
})

test("jumps from a finished shell's notice to its call", async ({ page }) => {
  await setupTimeline(page, {
    settings: { timelineDetail: detailed },
    sessionMessages: [
      userMessage(),
      assistantMessage([
        ...searches(0, 2),
        toolPart(
          "prt_notice_shell",
          "shell",
          "completed",
          { command: "bun serve.ts" },
          { output: "listening", metadata: { shellID: "shell_notice" } },
        ),
        ...searches(2, 2),
        textPart("prt_notice_notes", notes("Later", 80)),
      ]),
      {
        id: "msg_shell_finished",
        type: "synthetic",
        text: '<shell id="shell_notice" state="completed" command="bun serve.ts">\nlistening\n</shell>',
        description: "bun serve.ts",
        metadata: { source: "shell", shellID: "shell_notice", state: "completed" },
        time: { created: 1700000003000 },
      },
    ],
  })

  const notice = page.getByRole("button", { name: /^Shell finished/ })
  const shellTrigger = page.locator('[data-timeline-part-id="prt_notice_shell"] [data-slot="collapsible-trigger"]')

  await expect(notice).toBeInViewport()
  await expect(shellTrigger).toHaveCount(0)
  await notice.click()

  await expect(shellTrigger).toHaveAttribute("aria-expanded", "true")
  await expect(shellTrigger).toBeInViewport()
})

test.describe("Working", () => {
  test("shows Working between busy and reasoning states", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [userMessage()],
      sessionStatus: { [sessionID]: { type: "busy" } },
      viewport: { width: 390, height: 900 },
      settings: { timelineDetail: { ...detailed, thinking: { placement: "separate", details: "collapsed" } } },
    })

    const working = page.locator('[data-component="session-working"]')
    const shimmer = working.locator('[data-component="text-shimmer"]')
    await expect(working).toHaveCount(1)
    await expect(working).toHaveRole("status")
    await expect(shimmer).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()
    await expect(shimmer).toHaveAttribute("data-active", "true")
    await expect(shimmer).toHaveCSS("line-height", "16px")
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)

    await timeline.send(stepStarted(assistantMessage([], { completed: false })))
    await expect(working).toBeVisible()
    await timeline.send(partUpdated(reasoningPart("prt_working_reasoning", "")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
    await expect(working).toHaveCount(0)

    await timeline.send(partUpdated(reasoningPart("prt_working_reasoning", "The inspection is complete.")))
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect(shimmer).toHaveAttribute("aria-label", "Working")
    await expect(working).toBeInViewport()

    await timeline.send(status("idle"))
    await expect(working).toHaveCount(0)
  })

  test("shows an expandable live Thinking in place of Working while reasoning is the only activity", async ({
    page,
  }) => {
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([reasoningPart("prt_only_thought", "Still considering the answer.")], { completed: false }),
      ],
      settings: { timelineDetail: detailed },
    })

    // reasoningPart starts at 1700000001000, so the pause lands 8m 12s into the thought.
    await page.clock.install({ time: 1700000001000 })
    await page.reload()
    await timeline.transport.waitForConnection()

    const working = page.locator('[data-component="session-working"]')
    const group = page.locator('[data-component="collapsed-tool-group"]')
    const trigger = group.locator('[data-component="context-tool-group-trigger"]')
    const elapsed = trigger.locator('[data-slot="basic-tool-tool-subtitle"]')
    await expect(group).toHaveAttribute("data-timeline-part-ids", `${assistantID}:reasoning:0`)
    // The jump below fires the 60 s timeout of any request still in flight, so the busy status must land first.
    await expect(trigger).toHaveAttribute("aria-label", "Thinking")
    await page.clock.pauseAt(1700000001000 + 492_000)
    await expect(trigger.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
    await expect(elapsed).toHaveText("8m 12s")
    await expect(working).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Used 1 Thought" })).toHaveCount(0)

    await page.clock.fastForward(1_000)
    await expect(elapsed).toHaveText("8m 13s")

    await trigger.click()
    await expect(group.getByText("Still considering the answer.", { exact: true })).toBeVisible()

    // Event delivery schedules timers, so let time run again before streaming the next part.
    await page.clock.resume()

    await timeline.send(partUpdated(toolPart("prt_after_thought", "read", "running", { filePath: "package.json" })))
    await expect(group).toHaveAttribute("data-timeline-part-ids", `${assistantID}:reasoning:0,prt_after_thought`)
    await expect(trigger).toHaveAttribute("aria-label", "Used 1 Read")
    await expect(elapsed).toHaveCount(0)
    await expect(working).toBeVisible()
  })

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

      const input = {
        shell: { command: "printf ready" },
        patch: {
          patchText: "*** Begin Patch\n*** Add File: src/working.ts\n+export const ready = true\n*** End Patch",
        },
        subagent: { agent: "general", description: "Inspect working indicator", prompt: "Inspect the timeline." },
      }[name]

      await timeline.send(partUpdated(toolPart(id, name, "streaming", input)))
      const tool = page.locator(`[data-timeline-part-id="${id}"]`)
      await expect(tool).toBeVisible()
      await expect(working).toHaveCount(0)

      const metadata =
        name === "patch"
          ? { files: [{ ...patchFile("src/working.ts", "added"), patch: "@@ -0,0 +1 @@\n+export const ready = true" }] }
          : {}

      await timeline.send(partUpdated(toolPart(id, name, "running", input, { metadata })))
      await expect(tool).toContainText(
        { shell: "printf ready", patch: "working.ts", subagent: "Inspect working indicator" }[name],
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

  test("keeps Working while a new read joins a standalone read group", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          ["one", "two", "three"].map((name) =>
            toolPart(`prt_read_${name}`, "read", "completed", { path: `src/${name}.ts` }),
          ),
          { completed: false },
        ),
      ],
      settings: { timelineDetail: timelinePresets[0].value },
    })

    const working = page.locator('[data-component="session-working"]')
    const group = page.locator('[data-component="read-tool-group"]')
    const shimmer = group.locator('[data-component="text-shimmer"]')
    await expect(group).toHaveAttribute("data-timeline-part-ids", "prt_read_one,prt_read_two,prt_read_three")
    await expect(working).toBeVisible()

    await timeline.send(partUpdated(toolPart("prt_read_four", "read", "streaming", { path: "src/four.ts" })))
    await expect(group).toHaveAttribute(
      "data-timeline-part-ids",
      "prt_read_one,prt_read_two,prt_read_three,prt_read_four",
    )
    await expect(shimmer).toHaveAttribute("data-active", "true")
    await expect(working).toBeVisible()

    await timeline.send(partUpdated(toolPart("prt_read_four", "read", "running", { path: "src/four.ts" })))
    await expect(group.locator('[data-slot="basic-tool-tool-subtitle"]')).toHaveText(
      "one.ts, two.ts, three.ts, four.ts",
    )
    await expect(working).toBeVisible()

    await timeline.send(partUpdated(toolPart("prt_read_four", "read", "completed", { path: "src/four.ts" })))
    await expect(shimmer).toHaveAttribute("data-active", "false")
    await expect(working).toBeVisible()
  })

  for (const grouped of [false, true]) {
    test(`uses ${grouped ? "grouped" : "standalone"} background shell presentation`, async ({ page }) => {
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
                { metadata: { shellID: "sh_working_background", status: "running" } },
              ),
            ],
            { completed: false },
          ),
        ],
        shellCommands: [
          {
            id: "sh_working_background",
            status: "running",
            command: "sleep 10",
            cwd: directory,
            shell: "bash",
            file: "/tmp/working-background.out",
            metadata: { sessionID },
            time: { started: 2 },
          },
        ],
      })
      const working = page.locator('[data-component="session-working"]')

      if (!grouped) {
        await expect(page.locator('[data-timeline-part-id="prt_background_active"]')).toBeVisible()
        await expect(working).toHaveCount(0)

        return
      }

      const trigger = page
        .locator('[data-component="collapsed-tool-group"]')
        .getByRole("button", { name: "Used 2 Shell", exact: true, includeHidden: true })

      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeVisible()
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(working).toBeVisible()
    })
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
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)

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
})

test.describe("background shortcut", () => {
  test("offers a standalone running subagent to the background with Ctrl+B", async ({ page }) => {
    await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, subagents: { placement: "separate" } } },
      sessionMessages: [user, runningSubagent()],
    })
    const card = page.locator('[data-component="task-tool-card"]')
    await expect(card).toContainText("Inspect code")
    await expect(card).not.toContainText("(background)")
    await expect(page.getByText("Called `subagent`", { exact: false })).toHaveCount(0)
    await expect(page.locator('[data-component="background-tool-control"]')).toHaveCount(0)
    const hint = backgroundHint(page)
    await expect(hint).toBeVisible()
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await expect
      .poll(async () => {
        const [cardBox, hintBox] = await Promise.all([card.boundingBox(), hint.boundingBox()])

        if (!cardBox || !hintBox) return undefined

        return { aligned: Math.abs(cardBox.x - hintBox.x) < 2, ordered: cardBox.y < hintBox.y }
      })
      .toEqual({ aligned: true, ordered: true })
    await expectBackgroundRequest(page)
  })

  for (const name of ["read", "shell"] as const) {
    test(`keeps Working and the shortcut for a grouped running ${name}`, async ({ page }) => {
      await setupTimeline(page, {
        viewport: { width: name === "shell" ? 390 : 1400, height: 900 },
        settings: { timelineDetail: detailed },
        messages: [
          userMessage(),
          assistantMessage(
            [
              toolPart("prt_grouped_previous", "read", "completed", { filePath: "package.json" }),
              toolPart(
                "prt_grouped_active",
                name,
                "running",
                { read: { filePath: "src/working.ts" }, shell: { command: "sleep 10" } }[name],
              ),
            ],
            { completed: false },
          ),
        ],
      })
      const working = page.locator('[data-component="session-working"]')
      const group = page.locator('[data-timeline-part-ids="prt_grouped_previous,prt_grouped_active"]')
      const trigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeInViewport()

      if (name === "shell") {
        await expect(backgroundHint(page)).toBeInViewport()
        await expect(page.locator('[data-component="session-background-hint-row"]')).toHaveCSS("height", "24px")
      }

      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(group.locator('[data-component="text-shimmer"][data-active="true"]')).toBeVisible()
      await expect(working).toBeVisible()
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(working).toBeVisible()

      if (name === "shell") await expectBackgroundRequest(page)
    })
  }

  for (const placement of ["right", "center"] as const) {
    test(`anchors the activity panel to a ${placement}-placed capsule`, async ({ page }) => {
      await setupTimeline(page, {
        settings: { timelineDetail: detailed, backgroundActivity: placement },
        sessionMessages: [
          user,
          {
            id: "msg_backgrounded",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [
              {
                type: "tool",
                id: "call_shell_backgrounded",
                name: "shell",
                state: {
                  status: "completed",
                  input: { command: "sleep 120" },
                  content: [{ type: "text", text: "working" }],
                  metadata: { shellID: "shell_backgrounded", status: "running" },
                },
                time: { created: 2, completed: 3 },
              },
            ],
            time: { created: 2, completed: 3 },
          },
        ],
        shellCommands: [
          {
            id: "shell_backgrounded",
            status: "running",
            command: "sleep 120",
            cwd: directory,
            shell: "bash",
            file: "/tmp/background.out",
            metadata: { sessionID },
            time: { started: 2 },
          },
        ],
      })

      // The open menu hides the rest of the page from the accessibility tree, the capsule included.
      const capsule = page.getByRole("button", { name: "1 shell", exact: true, includeHidden: true })
      const list = page.getByRole("menu", { name: "1 shell", exact: true })
      const closed = (await capsule.boundingBox())!
      const inset = (await capsule.locator("svg").boundingBox())!.x - closed.x

      await capsule.click()
      // Right placement shares the capsule's end edge and mirrors its inset there; centre placement shares its centre.
      await expect
        .poll(async () => {
          const panel = (await list.boundingBox())!
          const anchor = (await capsule.boundingBox())!

          const end = await list
            .getByRole("menuitem")
            .locator('[data-slot="session-activity-elapsed"]')
            .evaluate((element) => element.getBoundingClientRect().right)

          return (
            panel.y + panel.height <= anchor.y &&
            Math.abs(panel.x + panel.width - end - inset) < 0.5 &&
            (placement === "right"
              ? Math.abs(panel.x + panel.width - (anchor.x + anchor.width)) < 0.5
              : Math.abs(panel.x + panel.width / 2 - (anchor.x + anchor.width / 2)) < 0.5)
          )
        })
        .toBe(true)
    })
  }

  test("counts a backgrounded subagent while its session runs, not while its call still reads running", async ({
    page,
  }) => {
    const childID = "ses_background_stale_call"

    // As after a lost completion notice: the call still reads running, while the child session has finished.
    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      sessionMessages: [
        user,
        {
          id: "msg_stale_call",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_stale",
              name: "subagent",
              state: {
                status: "completed",
                input: { description: "Stale task", agent: "explore", background: true },
                content: [{ type: "text", text: "working" }],
                metadata: { sessionID: childID, status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
          ],
          time: { created: 2, completed: 3 },
        },
      ],
      sessions: [session(), session({ id: childID, parentID: sessionID, title: "Stale task", agent: "explore" })],
    })

    const capsule = page.locator('[data-slot="session-activity-chip"]')

    await expect(page.locator('[data-timeline-part-id="call_stale"]')).toContainText("Stale task (background)")
    await expect(capsule).toHaveCount(0)
    await timeline.transport.send(status("busy", 1, childID))
    await expect(page.getByRole("button", { name: "1 subagent", exact: true })).toBeVisible()
    await timeline.transport.send(status("idle", 1, childID))
    await expect(capsule).toHaveCount(0)
  })

  test("separates blocking and already-backgrounded work into two rows", async ({ page }) => {
    const backgroundID = "ses_background_existing"
    const blockingID = "ses_background_blocking"

    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: detailed },
      sessionMessages: [
        user,
        {
          id: "msg_backgrounded",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_backgrounded",
              name: "subagent",
              state: {
                status: "completed",
                input: { description: "Background task", agent: "explore" },
                content: [{ type: "text", text: "working" }],
                metadata: { sessionID: backgroundID, status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
            {
              type: "tool",
              id: "call_shell_backgrounded",
              name: "shell",
              state: {
                status: "completed",
                input: { command: "sleep 120" },
                content: [{ type: "text", text: "working" }],
                metadata: { shellID: "shell_backgrounded", status: "running" },
              },
              time: { created: 2, completed: 3 },
            },
          ],
          time: { created: 2, completed: 3 },
        },
        {
          id: "msg_blocking",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_blocking",
              name: "subagent",
              state: {
                status: "running",
                input: { description: "Foreground task", agent: "build" },
                metadata: { sessionID: blockingID },
              },
              time: { created: 4 },
            },
          ],
          time: { created: 4 },
        },
      ],
      sessions: [
        session(),
        session({ id: backgroundID, parentID: sessionID, title: "Background task", agent: "explore" }),
        session({ id: blockingID, parentID: sessionID, title: "Foreground task", agent: "build" }),
      ],
      sessionStatus: {
        [sessionID]: { type: "busy" },
        [backgroundID]: { type: "busy" },
        [blockingID]: { type: "busy" },
      },
    })

    await timeline.transport.send({
      id: "evt_background_shell_created",
      created: 3,
      type: "shell.created",
      location: { directory },
      data: {
        info: {
          id: "shell_backgrounded",
          status: "running",
          command: "sleep 120",
          cwd: directory,
          shell: "bash",
          file: "/tmp/background.out",
          metadata: { sessionID },
          time: { started: 2 },
        },
      },
    })
    const backgroundCard = page.locator('[data-timeline-part-id="call_backgrounded"]')
    const blockingCard = page.locator('[data-timeline-part-id="call_blocking"]')
    await expect(backgroundHint(page)).toBeVisible()
    await expect(backgroundCard).toContainText("Background task (background)")
    await expect(blockingCard).toContainText("Foreground task")
    await expect(blockingCard).not.toContainText("(background)")

    const used = page
      .locator('[data-timeline-part-ids="call_shell_backgrounded"]')
      .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

    await expect(used).toHaveText(/^Used\s*1\s*Shell$/)
    await expect(used).toHaveAttribute("aria-expanded", "false")
    const activity = page.getByRole("button", { name: "2 subagents · 1 shell", exact: true })
    const list = page.getByRole("menu", { name: "2 subagents · 1 shell", exact: true })
    // The open menu hides the rest of the page from the accessibility tree, the capsule included.
    const capsule = page.getByRole("button", { name: "2 subagents · 1 shell", exact: true, includeHidden: true })
    const label = capsule.getByText("2 subagents · 1 shell", { exact: true })
    const glyph = await capsule.locator("svg").boundingBox()
    const text = await label.boundingBox()
    const inset = glyph!.x - (await capsule.boundingBox())!.x

    await activity.click()
    await expect(list.locator('[data-slot="menu-v2-group-label"], [data-slot="menu-v2-separator"]')).toHaveCount(0)
    await expect(list.getByText("2 subagents · 1 shell", { exact: true })).toHaveCount(0)
    await expect(label).toBeVisible()

    // The panel opens above the capsule on its grid: row glyphs on the capsule's glyph, names and commands on its
    // label, and run times ending as far from the panel's end as the glyphs start from its start.
    await expect
      .poll(async () => {
        const panel = await list.boundingBox()
        const anchor = await capsule.boundingBox()

        const rows = await list.getByRole("menuitem").evaluateAll((items) =>
          items.map((item) => {
            const content = item.querySelector('[data-slot="menu-v2-item-content"]')

            return [
              content?.querySelector(":scope > svg")?.getBoundingClientRect().left ?? NaN,
              content?.querySelector(":scope > span:not([data-slot])")?.getBoundingClientRect().left ?? NaN,
              item.querySelector('[data-slot="session-activity-elapsed"]')?.getBoundingClientRect().right ?? NaN,
            ]
          }),
        )

        return (
          panel!.y + panel!.height <= anchor!.y &&
          rows.length === 3 &&
          rows.every(
            ([left, start, end]) =>
              Math.abs(left - glyph!.x) < 0.5 &&
              Math.abs(start - text!.x) < 0.5 &&
              Math.abs(panel!.x + panel!.width - end - inset) < 0.5,
          )
        )
      })
      .toBe(true)
    await expect(list.getByRole("menuitem")).toHaveText([
      // The fixture starts every task near the epoch, so each row ends with an hours-long run time.
      /^Build\s*Foreground task\d+h \d{2}m$/,
      /^Explore\s*Background task\d+h \d{2}m$/,
      /^sleep 120\d+h \d{2}m$/,
    ])
    await list.getByRole("menuitem", { name: /sleep 120/ }).click()
    await expect(list).toHaveCount(0)
    await expect(used).toHaveAttribute("aria-expanded", "true")
    const shellCall = page.locator('[data-timeline-part-id="call_shell_backgrounded"]')
    await expect(shellCall.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
    await expect(shellCall).toBeInViewport()

    await activity.click()

    const interrupt = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${blockingID}/interrupt`,
    )

    const foreground = list.getByRole("menuitem", { name: /Foreground task/ })

    await foreground.hover()
    await foreground.getByRole("button", { name: "Interrupt subagent", exact: true }).click()
    await interrupt
    await expect(list).toBeVisible()

    const kill = page.waitForRequest(
      (request) => request.method() === "DELETE" && new URL(request.url()).pathname === "/api/shell/shell_backgrounded",
    )

    await list.getByRole("menuitem", { name: /sleep 120/ }).hover()
    await page.keyboard.press("Delete")
    await kill
    await page.keyboard.press("Escape")
    await expect(list).toHaveCount(0)
    await expect(backgroundCard).toContainText("Background task (background)")
    await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
    await expect(
      page.locator('[data-timeline-part-id="call_shell_backgrounded"] [data-component="text-shimmer"]'),
    ).toHaveAttribute("data-active", "true")

    // SAFETY: the transport forwards this payload unchanged, and the client marks a session idle from
    // `type` and `data.sessionID` alone; the child session's event needs no durable metadata here.
    await timeline.transport.send({
      id: "evt_background_succeeded",
      created: Date.now(),
      type: "session.execution.succeeded",
      data: { sessionID: backgroundID },
    } as never)
    await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
    await expect(backgroundCard).toContainText("Background task (background)")
  })

  for (const fixture of [
    { name: "from far below", before: 40, searches: 40, after: 80 },
    // The collapsed timeline fits the viewport, so it only becomes scrollable once the group opens.
    { name: "that opens the last row", before: 0, searches: 40, after: 0 },
    // Reaching the shell lands on the end of the timeline, which would otherwise follow new content again.
    { name: "at the end of the timeline", before: 40, searches: 0, after: 0 },
  ]) {
    test(`holds a revealed shell ${fixture.name} just under its stuck group header`, async ({ page }) => {
      const timeline = await setupTimeline(page, {
        settings: { timelineDetail: detailed },
        sessionStatus: { [sessionID]: { type: "busy" } },
        messages: [
          userMessage(),
          assistantMessage(
            [
              ...(fixture.before ? [textPart("prt_earlier", notes("Earlier", fixture.before))] : []),
              ...searches(0, 42 - fixture.searches),
              toolPart(
                "prt_far_shell",
                "shell",
                "completed",
                { command: "sleep 120" },
                { output: "working", metadata: { shellID: "shell_far", status: "running" } },
              ),
              // The open group outgrows the viewport, so aligning the group instead of the shell misses it.
              ...searches(42 - fixture.searches, fixture.searches),
              ...(fixture.after ? [textPart("prt_follow_up", notes("Follow-up", fixture.after))] : []),
            ],
            { completed: false },
          ),
        ],
      })

      await timeline.transport.send({
        id: "evt_far_shell_created",
        created: 3,
        type: "shell.created",
        location: { directory },
        data: {
          info: {
            id: "shell_far",
            status: "running",
            command: "sleep 120",
            cwd: directory,
            shell: "bash",
            file: "/tmp/far.out",
            metadata: { sessionID },
            time: { started: 2 },
          },
        },
      })

      const group = page
        .locator('[data-component="collapsed-tool-group"]')
        .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

      const shellTrigger = page.locator('[data-timeline-part-id="prt_far_shell"] [data-slot="collapsible-trigger"]')

      const aligned = () =>
        expect
          .poll(async () => {
            const [header, shell] = await Promise.all([group.boundingBox(), shellTrigger.boundingBox()])

            return header && shell ? Math.round(shell.y - (header.y + header.height)) : undefined
          })
          .toBe(0)

      await expect(
        fixture.after ? page.getByText(`Follow-up note ${fixture.after}.`, { exact: true }) : group,
      ).toBeInViewport()
      await expect(shellTrigger).toHaveCount(0)
      await page.getByRole("button", { name: "1 shell", exact: true }).click()
      await page
        .getByRole("menu", { name: "1 shell", exact: true })
        .getByRole("menuitem", { name: /sleep 120/ })
        .click()

      await expect(group).toHaveAttribute("aria-expanded", "true")
      await expect(shellTrigger).toHaveAttribute("aria-expanded", "true")
      await expect(shellTrigger).toBeInViewport()

      // A shell at the very end cannot rise under the header until more content arrives below it.
      if (fixture.searches) await aligned()
      // Nothing covers the row, so it takes the next click.
      await shellTrigger.click({ trial: true })

      // The agent keeps writing below the shell; the shell stays where it was revealed.
      await timeline.send(partUpdated(textPart("prt_late", notes("Late", 30))))
      await expect(page.getByText("Late note 30.", { exact: true })).toBeAttached()
      await aligned()
    })
  }

  test("shows a running subagent's working indicator beside its title", async ({ page }) => {
    const childID = "ses_only_running_child"

    const timeline = await setupTimeline(page, {
      sessionMessages: [user, completed],
      sessions: [
        session(),
        session({ id: childID, parentID: sessionID, title: "Only running task", agent: "explore" }),
      ],
      sessionStatus: { [childID]: { type: "busy" } },
    })

    const header = page.locator("[data-session-title]")

    await page.getByRole("button", { name: "1 subagent", exact: true }).click()
    await page.getByRole("menuitem", { name: /Only running task/ }).click()
    await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
    await expect(header.getByRole("heading")).toHaveText("Only running task")

    const working = header.getByRole("status", { name: "Working", exact: true })

    await expect(working.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()

    const gap = await working.evaluate((element) => {
      const title = document.createRange()

      title.selectNodeContents(element.nextElementSibling!)

      return title.getBoundingClientRect().left - element.getBoundingClientRect().right
    })

    expect(gap).toBe(8)

    const title = header.getByRole("heading")
    const before = await title.boundingBox()
    const exit = await pauseExitAnimations(working)

    await timeline.transport.send(status("idle", 1, childID))
    await expect.poll(() => exit.evaluate((animations) => animations.length)).toBeGreaterThan(0)
    await exit.evaluate((animations) => animations.forEach((animation) => (animation.currentTime = 100)))
    await expect(working).toBeAttached()

    const midway = await title.boundingBox()

    expect(midway!.x).toBeLessThan(before!.x)
    await exit.evaluate((animations) => animations.forEach((animation) => animation.finish()))
    await expect(working).toHaveCount(0)

    const after = await title.boundingBox()

    expect(after!.x).toBeLessThan(midway!.x)
    expect(after!.x).toBeCloseTo(before!.x - 24, 0)
    await exit.dispose()
    await header.locator('[data-slot="session-title-parent"]').click()
    await expect(page).toHaveURL(new RegExp(`/session/${sessionID}$`))
  })
})

test.describe("compaction", () => {
  test("renders compaction progress, summary, and outcome in order", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      settings: { timelineDetail: { ...detailed, notices: { placement: "separate" } } },
      sessionMessages: [user, completed],
      sessionStatus: { [sessionID]: { type: "busy" } },
    })

    await timeline.send(compactionStarted({ sessionID, reason: "manual", recent: "" }))
    const compaction = page.locator('[data-component="session-compaction-message"]')
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
    await expect(compaction.getByRole("status").getByLabel("Compacting", { exact: true })).toBeVisible()
    await expect(compaction.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
    await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-working"]')).toHaveCount(0)

    await page.setViewportSize({ width: 480, height: 900 })
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeInViewport()

    await timeline.send(compactionDelta({ sessionID, text: "## Checkpoint\n\nStreamed implementation details." }))
    await expect(compaction.getByRole("heading", { name: "Checkpoint" })).toBeVisible()
    await expect(compaction).toContainText("Streamed implementation details.")
    const running = compaction.getByRole("status").getByLabel("Compacting", { exact: true })
    await expect(running).toBeVisible()
    await expect
      .poll(async () => {
        const summary = await compaction.locator('[data-component="text-part"]').boundingBox()
        const status = await running.boundingBox()

        return !!summary && !!status && status.y >= summary.y + summary.height
      })
      .toBe(true)
    await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)

    await timeline.send(
      compactionEnded({
        sessionID,
        reason: "manual",
        text: "## Checkpoint\n\nFinal implementation details.",
        recent: "",
      }),
    )
    await expect(compaction).toContainText("Final implementation details.")
    await expect(compaction).not.toContainText("Streamed implementation details.")
    await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
    await expect(compaction.getByText("Session compacted", { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const summary = await compaction.locator('[data-component="text-part"]').boundingBox()
        const done = await compaction.getByText("Session compacted", { exact: true }).boundingBox()

        return !!summary && !!done && done.y >= summary.y + summary.height
      })
      .toBe(true)
    await expect(compaction.getByRole("status")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await expect(page.locator('[data-component="session-working"]')).toBeVisible()
  })

  test("shows an automatic compaction as one quiet divider with background compaction on", async ({ page }) => {
    const config = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/config")

    const timeline = await setupTimeline(page, {
      sessionMessages: [user, completed],
      sessionStatus: { [sessionID]: { type: "busy" } },
      configEntries: [{ type: "document", info: { experimental: { background_compaction: true } } }],
    })

    await config

    await timeline.send(compactionStarted({ sessionID, reason: "auto" }))
    await timeline.send(compactionDelta({ sessionID, text: "Partial automatic summary." }))
    const compaction = page.locator('[data-component="session-compaction-message"]')
    const divider = compaction.locator('[data-slot="session-compaction-divider"]')
    await expect(divider).toHaveAttribute("data-state", "running")
    await expect(compaction).not.toContainText("Partial automatic summary.")
    await expect(compaction).not.toContainText("Session compaction started")

    await timeline.send(compactionEnded({ sessionID, reason: "auto", text: "## Checkpoint\n\nAutomatic details." }))
    await expect(divider).toHaveAttribute("data-state", "done")
    await expect(divider).toHaveAccessibleName("Compacted")
    await expect(compaction).not.toContainText("Automatic details.")
    await divider.click()
    await expect(compaction).toContainText("Automatic details.")
  })

  const outcomes = {
    failed: {
      reason: "auto",
      partial: "Partial summary that should be discarded.",
      error: {
        type: "compaction.failed",
        message: 'Error: {"error":{"type":"ProviderError","message":"The provider rejected the summary."}}',
      },
      label: "Session compaction failed",
      shown: "ProviderError: The provider rejected the summary.",
    },
    cancelled: {
      reason: "manual",
      partial: "Summary before cancellation.",
      error: { type: "aborted", message: "Cancellation detail should stay hidden." },
      label: "Session compaction cancelled",
      shown: undefined,
    },
    interrupted: {
      reason: "auto",
      partial: "Partial automatic summary.",
      error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
      label: "Session compaction interrupted",
      shown: undefined,
    },
  } as const

  const labels = Object.values(outcomes).map((outcome) => outcome.label)

  // Failed then cancelled share one history, so each boundary must keep its own outcome.
  for (const names of [["failed", "cancelled"], ["interrupted"]] as const) {
    test(`ends running compactions as ${names.join(", then ")}`, async ({ page }) => {
      const timeline = await setupTimeline(
        page,
        names[0] === "interrupted"
          ? { sessionMessages: [user, completed], sessionStatus: { [sessionID]: { type: "busy" } } }
          : { sessionMessages: [user, completed] },
      )

      const compactions = page.locator('[data-component="session-compaction-message"]')

      for (const [index, name] of names.entries()) {
        const outcome = outcomes[name]
        await timeline.send(compactionStarted({ sessionID, reason: outcome.reason, recent: "" }))
        await timeline.send(compactionDelta({ sessionID, text: outcome.partial }))
        await expect(compactions).toHaveCount(index + 1)
        const compaction = compactions.nth(index)
        await expect(compaction).toContainText(outcome.partial)

        if (name === "interrupted") {
          await expect(compaction.getByRole("status").getByLabel("Compacting", { exact: true })).toBeVisible()

          const request = page.waitForRequest(
            (request) =>
              request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/interrupt`,
          )

          await page.getByRole("button", { name: "Stop", exact: true }).click()
          await request
        }

        await timeline.send(compactionFailed({ sessionID, reason: outcome.reason, error: outcome.error }))
        await expect(compaction.getByText(outcome.label, { exact: true })).toBeVisible()
      }

      await expect(compactions).toHaveCount(names.length)

      for (const [index, name] of names.entries()) {
        const outcome = outcomes[name]
        const compaction = compactions.nth(index)
        await expect(compaction.getByText("Session compaction started", { exact: true })).toBeVisible()
        await expect(compaction.getByText(outcome.label, { exact: true })).toBeVisible()

        for (const other of labels.filter((label) => label !== outcome.label))
          await expect(compaction.getByText(other, { exact: true })).toHaveCount(0)
        await expect(compaction.getByText("Session compacted", { exact: true })).toHaveCount(0)
        await expect(compaction.getByRole("status")).toHaveCount(0)
        await expect(compaction).not.toContainText(outcome.partial)

        if (outcome.shown) await expect(compaction.getByText(outcome.shown, { exact: true })).toBeVisible()

        if (!outcome.shown) await expect(compaction).not.toContainText(outcome.error.message)
      }
    })
  }
})

test("reducer-hardening: converges when idle arrives before final part and message completion", async ({ page }) => {
  const textID = "prt_event_order_text"
  const assistant = assistantMessage([textPart(textID, "Partial")], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  await timeline.send(status("busy"))
  await timeline.send(status("idle"))
  await timeline.send(partUpdated(textPart(textID, "Final after early idle")))
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)))

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(textID)}"]`)).toContainText(
    "Final after early idle",
  )
})

test("changes timeline presets and saves custom thinking details", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        reasoningPart("prt_reasoning_settings", "## Inspecting stability\n\nThe selected mode controls these details."),
      ]),
    ],
  })
  const part = page.locator(`[data-timeline-part-id="${assistantID}:reasoning:0"]`)
  const settings = page.getByTestId("settings-screen")
  await page.keyboard.press("Control+,")
  const slider = settings.getByRole("slider", { name: "Timeline detail", exact: true })
  await expect(slider).toBeEnabled()
  await slider.press("Home")

  for (const [index, name] of ["Messages only", "Quiet", "Compact", "Detailed", "Everything"].entries()) {
    if (index) await slider.press("ArrowRight")
    await expect(slider).toHaveValue(String(index))
    await expect(slider).toHaveAttribute("aria-valuetext", name)
  }

  await slider.press("End")
  await settings.getByRole("button", { name: "Advanced", exact: true }).click()
  const grouped = settings.getByRole("switch", { name: "Thinking grouped", exact: true })
  const collapsed = settings.getByRole("switch", { name: "Thinking collapsed", exact: true })
  await expect(grouped).not.toBeChecked()
  await expect(collapsed).not.toBeChecked()
  await settings.locator('[data-category="thinking"][data-field="placement"] [data-slot="switch-control"]').click()
  await settings.locator('[data-category="thinking"][data-field="details"] [data-slot="switch-control"]').click()
  await expect(grouped).toBeChecked()
  await expect(collapsed).toBeChecked()
  await expect(slider).toHaveAttribute("aria-valuetext", "Custom")
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.timelineDetail?.thinking),
    )
    .toEqual({ placement: "grouped", details: "collapsed" })
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(settings).toBeHidden()
  await page.getByRole("button", { name: "Used 1 Thought", exact: true }).click()
  await expect(part.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await part.getByRole("button").click()
  await expect(part.getByText("The selected mode controls these details.", { exact: true })).toBeVisible()
})

test.describe("shell completion", () => {
  const background = {
    id: "sh_background",
    status: "running",
    command: "bun run check",
    cwd: directory,
    shell: "bash",
    file: "/tmp/check.out",
    metadata: { sessionID },
    time: { started: 2 },
  } satisfies ShellInfo

  // Every exit status takes the same completion path, so one grouped and one standalone row cover it.
  for (const { grouped, exit } of [
    { grouped: false, exit: "exited" },
    { grouped: true, exit: "killed" },
  ] as const) {
    test(`stops ${grouped ? "grouped" : "standalone"} background shell shimmer when ${exit}`, async ({ page }) => {
      const message: SessionMessageAssistant = {
        id: "msg_background",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          ...(grouped
            ? [
                {
                  type: "tool",
                  id: "call_read",
                  name: "read",
                  state: {
                    status: "completed",
                    input: { path: "package.json" },
                    content: [{ type: "text", text: "{}" }],
                    metadata: {},
                  },
                  time: { created: 1, completed: 2 },
                } satisfies SessionMessageAssistant["content"][number],
              ]
            : []),
          ...[background.id, "sh_other"].map((id): SessionMessageAssistant["content"][number] => ({
            type: "tool",
            id: `call_${id}`,
            name: "shell",
            state: {
              status: "completed",
              input: { command: background.command },
              content: [{ type: "text", text: "Command moved to the background." }],
              metadata: { shellID: id, status: "running" },
            },
            time: { created: 2, completed: 3 },
          })),
        ],
        time: { created: 2, completed: 3 },
      }

      const state = { finished: false, requests: 0 }
      // Larger than one server page (65,536 bytes), so the final output is read in two pages. The card shows its most
      // recent 64 KiB.
      const finished = `Checking project\n${Array.from({ length: 8_192 }, (_, index) => `step ${String(index + 1).padStart(5, "0")}\n`).join("")}Check finished\n`
      const tail = finished.slice(-64 * 1024)
      // Byte cursors of this shell's output reads.
      const reads: number[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())

        if (url.pathname === `/api/shell/${background.id}/output`)
          reads.push(Number(url.searchParams.get("cursor") ?? 0))
      })

      const timeline = await setupTimeline(page, {
        viewport: { width: grouped ? 390 : 1400, height: 900 },
        settings: { shellToolPartsExpanded: !grouped },
        sessionStatus: { [sessionID]: { type: "busy" } },
        sessionMessages: [
          { id: "msg_user", type: "user", text: "Run two independent checks.", time: { created: 1 } },
          message,
        ],
        shellCommands: () => [...(state.finished ? [] : [background]), { ...background, id: "sh_other" }],
        shellOutput: ({ id }) => {
          if (id !== background.id) return "Checking project\n"
          state.requests++

          return state.finished ? finished : "Checking project\n"
        },
      })

      await page.clock.install()
      await page.reload()
      await timeline.transport.waitForConnection()

      const groupTrigger = page
        .locator('[data-component="collapsed-tool-group"]')
        .locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

      if (grouped) {
        await expect(page.locator('[data-component="collapsed-tool-group"]')).toHaveAttribute(
          "data-timeline-part-ids",
          "call_read,call_sh_background,call_sh_other",
        )
        await expect(groupTrigger).toHaveAttribute("aria-expanded", "false")
        await groupTrigger.click()
      }

      const card = page.locator(`[data-timeline-part-id="call_${background.id}"]`)
      const shimmer = card.locator('[data-component="text-shimmer"]')
      const other = page.locator('[data-timeline-part-id="call_sh_other"] [data-component="text-shimmer"]')
      await expect(shimmer).toHaveAttribute("data-active", "true")
      await expect(other).toHaveAttribute("data-active", "true")

      if (grouped) await card.locator('[data-slot="collapsible-trigger"]').click()
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText("Checking project")

      state.finished = true
      await timeline.transport.send({
        id: "evt_shell_exited",
        created: 4,
        type: "shell.exited",
        location: { directory },
        data: { id: background.id, status: exit, exit: exit === "exited" ? 0 : 1 },
      })
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText(tail)
      // The first page from the running output's cursor ends 65,536 bytes later; the second page starts there.
      expect(reads).toContain(17 + 65_536)
      await expect(card.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")

      const requests = state.requests
      await page.clock.fastForward(5_000)
      expect(state.requests).toBe(requests)

      reads.length = 0
      await page.reload()

      if (grouped) await groupTrigger.click()
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")

      // An expanded card reads the exited shell's final output from the start, again in two pages.
      if (grouped) return
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText(tail)
      expect(reads).toContain(65_536)
    })
  }

  test("shows the authoritative foreground result after streaming shell output", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      settings: { shellToolPartsExpanded: true },
      sessionMessages: [
        { id: "msg_user", type: "user", text: "Run the check.", time: { created: 1 } },
        {
          id: "msg_foreground",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "call_foreground",
              name: "shell",
              state: {
                status: "running",
                input: { command: background.command },
                metadata: { shellID: background.id },
              },
              time: { created: 2 },
            },
          ],
          time: { created: 2 },
        },
      ],
      shellOutput: ({ id }) => (id === background.id ? "Checking project\n" : undefined),
    })

    const card = page.locator('[data-timeline-part-id="call_foreground"]')
    const shimmer = card.locator('[data-component="text-shimmer"]')
    await expect(shimmer).toHaveAttribute("data-active", "true")
    await expect(card.locator('[data-slot="bash-result"]')).toHaveText("Checking project")
    await timeline.transport.send({
      id: "evt_foreground_complete",
      created: 3,
      type: "session.tool.success",
      durable: { aggregateID: sessionID, seq: 0, version: 2 },
      data: {
        sessionID,
        assistantMessageID: "msg_foreground",
        id: "call_foreground",
        executed: true,
        content: [{ type: "text", text: "Checking project\nCheck finished\nCommand exited with code 0." }],
        metadata: { status: "completed", exit: 0 },
      },
    })
    await expect(shimmer).toHaveAttribute("data-active", "false")
    await expect(card.locator('[data-slot="bash-result"]')).toHaveText(
      "Checking project\nCheck finished\nCommand exited with code 0.",
    )
  })
})

test("quotes plain timeline text into the composer, with or without a comment", async ({ page }) => {
  const prompts: string[] = []
  await setupTimeline(page, {
    messages: [
      userMessage([userText("Explain the build", { id: "prt_quote_user" })]),
      assistantMessage([textPart("prt_quote_answer", "It has **two** steps:\n\n- compile\n- bundle")]),
    ],
    onPrompt: (input) => void prompts.push(String(input.body.text)),
  })

  const user = '[data-slot="user-message-text"]'
  const answer = `[data-timeline-part-id="${renderedPartID("prt_quote_answer")}"] [data-slot="text-part-body"]`
  await expect(page.locator(answer).getByText("bundle", { exact: true })).toBeVisible()

  const select = (from: string, to: string) =>
    page.evaluate(
      (selectors) => {
        const [start, end] = selectors.map((selector) => document.querySelector(selector))

        if (!start || !end) throw new Error("Selection target is missing")
        const range = document.createRange()
        range.setStart(start, 0)
        range.setEnd(end, end.childNodes.length)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      },
      [from, to],
    )

  // A selection across the user's message and the answer quotes their text, not the controls between them.
  await select(user, answer)
  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await expect(toolbar).toHaveCount(0)
  const chips = page.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  await expect(chips).toHaveCount(1)
  await expect(chips).toContainText("Explain the build")

  // A quote's chip takes its comment; saving an emptied comment clears it again.
  await select(answer, answer)
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await expect(chips).toHaveCount(2)
  const comment = page.locator('[data-component="composer-quote-comment"] textarea')
  await chips.nth(1).click()
  await comment.fill("Why three?")
  await comment.press("Enter")
  await expect(comment).toHaveCount(0)
  await expect(chips.nth(1)).toContainText("Why three?")
  await chips.nth(1).click()
  await expect(comment).toHaveValue("Why three?")
  await comment.fill("")
  await comment.press("Enter")
  await expect(chips.nth(1)).not.toContainText("Why three?")
  await chips.nth(1).click()
  await comment.fill("Why two?")
  await comment.press("Escape")
  await expect(chips.nth(1)).not.toContainText("Why two?")
  await chips.nth(1).click()
  await comment.fill("Why two?")
  await comment.press("Enter")
  await expect(chips.nth(1)).toContainText("Why two?")

  // The shell turns selection off, so select all in the timeline selects its conversation and offers to quote it.
  await page.locator(answer).getByText("bundle", { exact: true }).click()
  await page.keyboard.press("ControlOrMeta+a")
  await expect(toolbar).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(toolbar).toHaveCount(0)

  const editor = page.locator('[data-component="composer-editor"]')
  await editor.press("Enter")
  await expect
    .poll(() => prompts)
    .toEqual([
      [
        "The user quoted the following from earlier in the conversation:",
        "> Explain the build",
        "> ",
        "> It has two steps:",
        "> compile",
        "> bundle",
        "The user quoted the following from earlier in the conversation:",
        "> It has two steps:",
        "> compile",
        "> bundle",
        "",
        "The user made the following comment regarding this quote: Why two?",
      ].join("\n"),
    ])
  await expect(chips).toHaveCount(0)
})

test("highlights a quote's source only while its first comment is written", async ({ page }) => {
  let reject = true
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart("prt_highlight_first", "The same **quoted** **words**."),
        textPart("prt_highlight_second", "The same **quoted** **words**."),
      ]),
    ],
    onPrompt: () => {
      if (reject) throw new Error("Quote send failed")
    },
  })
  const firstID = renderedPartID("prt_highlight_first")
  const secondID = renderedPartID("prt_highlight_second")
  const first = page.locator(`[data-timeline-part-id="${firstID}"] [data-slot="text-part-body"]`)
  const second = page.locator(`[data-timeline-part-id="${secondID}"] [data-slot="text-part-body"]`)
  await expect(second).toHaveText("The same quoted words.")

  const highlights = () =>
    page.evaluate(() =>
      ["timeline-quote-source"].map((name) =>
        [...(CSS.highlights.get(name) ?? [])].map((range) => ({
          part: range.startContainer.parentElement
            ?.closest("[data-timeline-part-id]")
            ?.getAttribute("data-timeline-part-id"),
          text: range.toString(),
        })),
      ),
    )

  const selectionCollapsed = () => page.evaluate(() => window.getSelection()?.isCollapsed ?? true)

  const select = (target: Locator) =>
    target.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })

  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  const chips = page.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  const editor = page.locator('[data-component="composer-editor"]')
  const comment = page.locator('[data-component="composer-quote-comment"] textarea')
  const firstRange = { part: firstID, text: "The same quoted words." }
  const scroll = page.locator('[data-slot="session-timeline-scroll"] > [data-scrollable]')

  await scroll.focus()
  await select(first)
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click({ modifiers: ["Alt"] })
  await expect(comment).toBeFocused()
  await comment.fill("Keep this passage visible while I write.")
  await expect.poll(highlights).toEqual([[firstRange]])

  for (const palette of [
    { colorScheme: "dark" as const, background: "color(srgb 0.635294 0.737255 1 / 0.25)" },
    { colorScheme: "light" as const, background: "color(srgb 0.133333 0.219608 0.560784 / 0.1)" },
  ]) {
    await page.emulateMedia({ colorScheme: palette.colorScheme })
    await expect
      .poll(() =>
        first.evaluate((element) =>
          [
            "::selection",
            "::highlight(timeline-quote-source)",
          ].map((pseudo) => {
            const style = getComputedStyle(element, pseudo)

            return {
              background: style.backgroundColor,
              preservesText: style.color === getComputedStyle(element).color,
            }
          }),
        ),
      )
      .toEqual([
        { background: palette.background, preservesText: true },
        { background: palette.background, preservesText: true },
      ])
  }

  await comment.press("Enter")
  await expect(comment).toHaveCount(0)
  await expect.poll(highlights).toEqual([[]])

  await select(second)
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await expect(chips).toHaveCount(2)
  await expect(editor).toBeFocused()
  await expect.poll(selectionCollapsed).toBe(true)
  await expect.poll(highlights).toEqual([[]])

  const before = await scroll.evaluate((element) => element.scrollTop)
  await chips.nth(0).hover()
  await expect(editor).toBeFocused()
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(before)
  await expect.poll(highlights).toEqual([[]])

  // Editing an existing quote's comment shows no source highlight.
  await chips.nth(0).click()
  await expect(comment).toBeFocused()
  await expect(comment).toHaveValue("Keep this passage visible while I write.")
  await expect.poll(highlights).toEqual([[]])
  await comment.press("Escape")
  await expect(comment).toHaveCount(0)

  await page
    .locator('[data-component="composer-attachments"]')
    .getByRole("button", { name: "Remove attachment" })
    .nth(0)
    .click()
  await expect(chips).toHaveCount(1)

  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/prompt") && response.status() === 500,
  )

  await editor.press("Enter")
  await rejected
  await expect(chips).toHaveCount(1)
  await expect(editor).toBeFocused()
  reject = false
  await editor.press("Enter")
  await expect(chips).toHaveCount(0)
  await expect.poll(highlights).toEqual([[]])
  await expect(page.locator('[data-component="timeline-quote-background"]')).toHaveCount(0)
})

test("keeps the native selection height after quoting wrapped and formatted text", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart(
          "prt_quote_height",
          "A selected passage with **bold text** and `inline code` that continues onto another line. ".repeat(4),
        ),
      ]),
    ],
  })

  const source = page.locator(
    `[data-timeline-part-id="${renderedPartID("prt_quote_height")}"] [data-slot="text-part-body"]`,
  )

  await expect(source).toContainText("A selected passage with bold text and inline code")
  await source.evaluate((element) => {
    const paragraph = element.querySelector("p")!
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 2)
    range.setEnd(paragraph, paragraph.childNodes.length - 2)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  })
  await page
    .getByRole("toolbar", { name: "Quote selection" })
    .getByRole("button", { name: "Quote", exact: true })
    .click({ modifiers: ["Alt"] })
  await expect(page.locator('[data-component="composer-quote-comment"] textarea')).toBeFocused()

  await page.setViewportSize({ width: 700, height: 900 })
  const height = await source.locator("p").evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))
  await expect
    .poll(() =>
      source.locator('[data-component="timeline-quote-background"] > span').evaluateAll(
        (lines, height) =>
          lines.length > 0 && lines.every((line) => Math.abs(line.getBoundingClientRect().height - height) < 0.1),
        height,
      ),
    )
    .toBe(true)
})

test("reveals a pending quote's source and restores its retained draft after its row remounts", async ({ page }) => {
  await setupTimeline(page, {
    seedHistory: true,
    messages: [
      userMessage(),
      assistantMessage([textPart("prt_quote_remount", "Keep this exact source highlighted.")]),
      userMessage([userText("Continue with the next step.")], { id: "msg_quote_following_user" }),
      assistantMessage([textPart("prt_quote_following_answer", "The next step is ready.")], {
        id: "msg_quote_following_answer",
        parentID: "msg_quote_following_user",
      }),
    ],
  })
  const partID = renderedPartID("prt_quote_remount")
  const source = page.locator(`[data-timeline-part-id="${partID}"] [data-slot="text-part-body"]`)
  await expect(source).toHaveText("Keep this exact source highlighted.")
  await source.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  })
  await page
    .getByRole("toolbar", { name: "Quote selection" })
    .getByRole("button", { name: "Quote", exact: true })
    .click({ modifiers: ["Alt"] })
  const chip = page.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  const comment = page.locator('[data-component="composer-quote-comment"] textarea')
  await expect(comment).toBeFocused()
  await expect(chip).toContainText("Keep this exact source highlighted.")

  const highlighted = () =>
    page.evaluate(() =>
      [...(CSS.highlights.get("timeline-quote-source") ?? [])].flatMap((range) =>
        range.startContainer.isConnected ? [range.toString()] : [],
      ),
    )

  await expect.poll(highlighted).toEqual(["Keep this exact source highlighted."])

  const scroll = page.locator('[data-slot="session-timeline-scroll"] > [data-scrollable]')
  await scroll.hover({ position: { x: 20, y: 100 } })
  await page.mouse.wheel(0, -10000)
  await expect(source).toHaveCount(0)
  const top = await scroll.evaluate((element) => element.scrollTop)
  await chip.hover()
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(top)

  // Clicking the pending card closes its open comment, and reveals the source before it does.
  await chip.click()
  await expect(comment).toHaveCount(0)
  await expect(source).toBeInViewport()
  await expect.poll(highlighted).toEqual([])

  // An existing quote's card edits its comment without moving the timeline to its source.
  await scroll.hover({ position: { x: 20, y: 100 } })
  await page.mouse.wheel(0, -10000)
  await expect(source).toHaveCount(0)
  await chip.click()
  await expect(comment).toBeFocused()
  await expect(source).toHaveCount(0)
  await expect.poll(highlighted).toEqual([])
  await comment.press("Escape")

  const href = new URL(page.url()).pathname
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(chip).toHaveCount(0)
  await expect.poll(highlighted).toEqual([])
  await page.locator(`[data-titlebar-tab-link][href="${href}"]`).click()
  await expect(chip).toContainText("Keep this exact source highlighted.")
  await expect.poll(highlighted).toEqual([])
  await expect(comment).toHaveCount(0)
})

test("quotes table rows and diff lines selected across a diff viewer", async ({ page }) => {
  const prompts: string[] = []
  await setupTimeline(page, {
    settings: { editToolPartsExpanded: true },
    messages: [
      userMessage(),
      assistantMessage([
        textPart("prt_quote_table", "| File | Change |\n| --- | --- |\n| a.ts | rename |"),
        toolPart(
          "prt_quote_edit",
          "edit",
          "completed",
          { path: "src/a.ts", oldString: "export const value = 'before'", newString: "export const value = 'after'" },
          {
            output: "Edited src/a.ts",
            title: "src/a.ts",
            metadata: {
              files: [
                {
                  file: "src/a.ts",
                  patch: createTwoFilesPatch(
                    "a/src/a.ts",
                    "b/src/a.ts",
                    "export const value = 'before'\n",
                    "export const value = 'after'\n",
                  ),
                  additions: 1,
                  deletions: 1,
                  status: "modified",
                },
              ],
            },
          },
        ),
      ]),
    ],
    onPrompt: (input) => void prompts.push(String(input.body.text)),
  })

  const removed = page.locator('[data-line-type="change-deletion"][data-line]')
  const added = page.locator('[data-line-type="change-addition"][data-line]')
  await expect(added).toHaveText("export const value = 'after'")
  await expect
    .poll(() => added.evaluate((element) => getComputedStyle(element, "::selection").backgroundColor))
    .toBe("color(srgb 0.133333 0.219608 0.560784 / 0.1)")

  const drag = async (from: Locator, to: Locator) => {
    const start = await from.boundingBox()
    const end = await to.boundingBox()

    if (!start || !end) throw new Error("Selection target is not laid out")
    await page.mouse.move(start.x + 1, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 10 })
    await page.mouse.up()
  }

  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  const chips = page.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')

  // Headers are unselectable chrome; body cells quote with tabs, followed by the diff lines and their markers.
  await drag(page.locator("td").getByText("a.ts", { exact: true }), added)
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click({ modifiers: ["Alt"] })
  await expect(chips).toHaveCount(1)
  await expect(page.locator('[data-component="composer-quote-comment"] textarea')).toBeFocused()

  const diffHighlights = (name: string) =>
    page.evaluate(
      (name) =>
        [...(CSS.highlights.get(name) ?? [])].flatMap((range) =>
          range.startContainer.getRootNode() instanceof ShadowRoot ? [range.toString()] : [],
        ),
      name,
    )

  await expect
    .poll(() => diffHighlights("timeline-quote-source"))
    .toEqual(["export const value = 'before'", "export const value = 'after'"])
  // Only the first comment keeps the source highlighted; saving it clears the highlight.
  await page.locator('[data-component="composer-quote-comment"] textarea').press("Enter")
  await expect.poll(() => diffHighlights("timeline-quote-source")).toEqual([])

  // The quote stops where a selection inside the diff viewer ends.
  await drag(page.locator("td").getByText("a.ts", { exact: true }), removed)
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await expect(chips).toHaveCount(2)

  await page.locator('[data-component="composer-editor"]').press("Enter")
  await expect
    .poll(() => prompts)
    .toEqual([
      [
        "The user quoted the following from earlier in the conversation:",
        "> a.ts\trename",
        "> ",
        "> -export const value = 'before'",
        "> +export const value = 'after'",
        "The user quoted the following from earlier in the conversation:",
        "> a.ts\trename",
        "> ",
        "> -export const value = 'before'",
      ].join("\n"),
    ])
})

test("places the quote action by the end a selection was made towards", async ({ page }) => {
  const paragraph = Array.from(
    { length: 14 },
    (_, index) => `Sentence ${index} explains one more part of the build.`,
  ).join(" ")

  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart("prt_place_short", "A short line with a word."),
        textPart("prt_place_long", Array.from({ length: 10 }, () => paragraph).join("\n\n")),
      ]),
    ],
  })

  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  const scroller = page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport')
  const first = page.locator(`[data-timeline-part-id="${renderedPartID("prt_place_long")}"] p`).first()
  await expect(first).toBeVisible()

  const box = async (locator: Locator) => {
    const value = await locator.boundingBox()

    if (!value) throw new Error("Element is not laid out")

    return value
  }

  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    await expect(toolbar).toBeVisible()

    return box(toolbar)
  }

  // The middle of the selected text, whose right edge is ragged where its lines wrap.
  const middle = () =>
    page.evaluate(() => {
      const rects = [...(window.getSelection()?.getRangeAt(0).getClientRects() ?? [])].filter((rect) => rect.width > 0)

      return (Math.min(...rects.map((rect) => rect.left)) + Math.max(...rects.map((rect) => rect.right))) / 2
    })

  // Pressing inside a selection drags its text, so each case starts from no selection.
  const clear = async () => {
    await page.keyboard.press("Escape")
    await expect(toolbar).toHaveCount(0)
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
  }

  await first.scrollIntoViewIfNeeded()
  const lines = await box(first)
  const start = { x: lines.x + 1, y: lines.y + 8 }
  const end = { x: lines.x + lines.width - 1, y: lines.y + lines.height - 8 }

  // A short selection keeps the action above it, even when dragged down.
  const short = await drag(start, { x: lines.x + 200, y: lines.y + 30 })
  expect(short.y + short.height).toBeLessThanOrEqual(lines.y)
  expect(Math.abs(short.x + short.width / 2 - (await middle()))).toBeLessThan(2)
  await clear()

  // A tall downward selection puts the action below its last line, centred on the lines.
  const down = await drag(start, end)
  expect(down.y).toBeGreaterThanOrEqual(lines.y + lines.height)
  expect(Math.abs(down.x + down.width / 2 - (await middle()))).toBeLessThan(2)
  await clear()

  // A tall upward one puts it above its first line.
  const up = await drag(end, start)
  expect(up.y + up.height).toBeLessThanOrEqual(lines.y)
  expect(Math.abs(up.x + up.width / 2 - (await middle()))).toBeLessThan(2)
  await clear()

  // A single line keeps it above the selection, centred on it, whichever way it was made.
  const word = page.getByText("A short line with a word.", { exact: true })

  // The paragraph spans the column; the text inside it is narrower.
  const line = await word.evaluate((element) => {
    element.scrollIntoView({ block: "center" })
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

  const single = await drag(
    { x: line.x + line.width - 1, y: line.y + line.height / 2 },
    { x: line.x + 1, y: line.y + line.height / 2 },
  )

  expect(single.y + single.height).toBeLessThanOrEqual(line.y)
  expect(Math.abs(single.x + single.width / 2 - (line.x + line.width / 2))).toBeLessThan(2)
  await clear()

  // A narrower timeline, as when a side panel opens, moves the action with the reflowed text.
  const scroll = page.locator('[data-slot="session-timeline-scroll"]')

  const centre = async () => {
    const action = await box(toolbar)

    return Math.abs(action.x + action.width / 2 - (await middle())) < 2
  }

  await word.click({ clickCount: 3, position: { x: 4, y: line.height / 2 } })
  await expect(toolbar).toBeVisible()
  await expect.poll(centre).toBe(true)
  await scroll.evaluate((element) => (element.style.width = "60%"))
  await expect.poll(centre).toBe(true)
  await scroll.evaluate((element) => (element.style.width = ""))
  await clear()

  // A selection running past both edges of the timeline pins the action to its bottom.
  await first.click()
  await page.keyboard.press("ControlOrMeta+a")
  await expect(toolbar).toBeVisible()
  await scroller.evaluate((element) => (element.scrollTop = (element.scrollHeight - element.clientHeight) / 2))
  const view = await box(scroller)
  await expect
    .poll(async () => Math.round((await box(toolbar)).y + (await box(toolbar)).height))
    .toBe(Math.round(view.y + view.height - 8))
})

test("keeps the quote action by a triple-clicked paragraph whose selection runs on to the next message", async ({
  page,
}) => {
  await setupTimeline(page, {
    messages: [
      userMessage([userText("Highlight what?", { id: "prt_triple_ask" })], { id: "msg_1000_triple_user" }),
      assistantMessage(
        [
          textPart(
            "prt_triple_text",
            "Highlight **visible prompt bubbles only**, or else the turn whose reply is being read.",
          ),
          toolPart("prt_triple_read", "read", "completed", { path: "src/a.ts" }, { output: "a", title: "src/a.ts" }),
          toolPart("prt_triple_grep", "grep", "completed", { pattern: "a" }, { output: "a", title: "a" }),
        ],
        { id: "msg_1001_triple_assistant", parentID: "msg_1000_triple_user" },
      ),
      userMessage([userText("have you finished?", { id: "prt_triple_next" })], {
        id: "msg_1002_triple_user",
        created: 1700000005000,
      }),
    ],
  })

  const paragraph = page.getByText("or else the turn whose reply is being read", { exact: false })
  await expect(paragraph).toBeVisible()
  // The selection ends at the start of the next message, past the tools between them.
  await paragraph.click({ clickCount: 3, position: { x: 4, y: 8 } })
  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  await expect(toolbar).toBeVisible()
  const text = await paragraph.boundingBox()
  const action = await toolbar.boundingBox()

  if (!text || !action) throw new Error("Element is not laid out")
  // One line, so the action sits just above it rather than below the tools the selection runs past.
  expect(action.y + action.height).toBeLessThanOrEqual(text.y)
  expect(action.y + action.height).toBeGreaterThanOrEqual(text.y - 10)

  // A press on unselectable space, which leaves the selection to the page, clears it before the button is released.
  const view = await page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport').boundingBox()

  if (!view) throw new Error("Element is not laid out")
  await page.mouse.move(view.x + 30, text.y + 4)
  await page.mouse.down()
  await expect(toolbar).toHaveCount(0)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("")
  await page.mouse.up()
})

for (const input of [
  { name: "a narrow window with a mouse anchors it to the selection", touch: false },
  { name: "a touch screen docks it to the timeline's bottom", touch: true },
])
  test(`places the quote action: ${input.name}`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: input.touch })
    const page = await context.newPage()
    await setupTimeline(page, {
      viewport: { width: 390, height: 844 },
      messages: [userMessage(), assistantMessage([textPart("prt_dock_text", "A short line to quote.")])],
    })

    const text = page.getByText("A short line to quote.", { exact: true })
    await expect(text).toBeVisible()
    await text.evaluate((element) => window.getSelection()?.selectAllChildren(element))
    const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
    await expect(toolbar).toBeVisible()
    const line = await text.boundingBox()
    const view = await page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport').boundingBox()
    const action = await toolbar.boundingBox()

    if (!line || !view || !action) throw new Error("Element is not laid out")

    if (input.touch) expect(Math.round(action.y + action.height)).toBe(Math.round(view.y + view.height - 8))
    else expect(action.y + action.height).toBeLessThanOrEqual(line.y)
    await context.close()
  })

test("opens a quote's comment with Alt-click", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart("prt_alt_first", "The first sentence to quote."),
        textPart("prt_alt_second", "The second sentence to quote."),
      ]),
    ],
  })

  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })
  const chips = page.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  const comment = page.locator('[data-component="composer-quote-comment"] textarea')

  const select = async (text: string) => {
    await page
      .locator('[data-slot="text-part-body"]')
      .getByText(text, { exact: true })
      .evaluate((element) => window.getSelection()?.selectAllChildren(element))
    await expect(toolbar).toBeVisible()
  }

  // A plain click adds the quote, leaves the comment closed, and returns the caret to where the draft left it.
  const editor = page.locator('[data-component="composer-editor"]')
  await editor.click()
  await page.keyboard.type("Draft")
  await select("The first sentence to quote.")
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await expect(chips).toHaveCount(1)
  await expect(comment).toHaveCount(0)
  await expect(editor).toBeFocused()
  await page.keyboard.type(" follow-up")
  await expect(editor).toHaveText("Draft follow-up")
  await chips.nth(0).hover()
  await page.getByRole("button", { name: "Remove attachment" }).click()
  await expect(chips).toHaveCount(0)

  // A slow tooltip names the action and its shortcut.
  await select("The first sentence to quote.")
  await toolbar.getByRole("button", { name: "Quote", exact: true }).hover()
  const tooltip = page.locator('[data-component="tooltip-v2"]', { hasText: "Quote and comment" })
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('[data-slot="keybind-v2-label"]')).toHaveText([/^(⌥|Alt)$/])

  // Alt-click opens the new quote's comment, focused.
  await page.keyboard.down("Alt")
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await page.keyboard.up("Alt")
  await expect(chips).toHaveCount(1)
  await expect(comment).toBeFocused()
  await page.keyboard.type("Why first?")
  await page.keyboard.press("Enter")
  await expect(comment).toHaveCount(0)
  await expect(chips.nth(0)).toContainText("Why first?")

  // Enter on an empty comment keeps the quote without one.
  await select("The second sentence to quote.")
  await page.keyboard.down("Alt")
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click()
  await page.keyboard.up("Alt")
  await expect(comment).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(comment).toHaveCount(0)
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(1)).toContainText("The second sentence to quote.")
  await expect(chips.nth(1)).toContainText("Quote")
})

test("reaches the quote action from the keyboard and blocks a selection over the limit", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart("prt_quote_short", "Short answer."),
        textPart("prt_quote_long", Array.from({ length: 3_000 }, (_, index) => `word${index}`).join(" ")),
      ]),
    ],
  })

  const short = page.getByText("Short answer.", { exact: true })
  await expect(short).toBeVisible()
  const toolbar = page.getByRole("toolbar", { name: "Quote selection" })

  // A drag released where no pointerup arrives, such as outside the window, still lets the selection settle.
  await short.click()
  await page.mouse.down()
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await short.evaluate((element) => window.getSelection()?.selectAllChildren(element))
  await expect(toolbar).toBeVisible()
  await page.mouse.up()

  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("button", { name: "Quote", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(toolbar).toHaveCount(0)
  await expect(page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport')).toBeFocused()

  const scroller = page.locator('[data-slot="session-timeline-scroll"] .scroll-view__viewport')
  const composer = page.locator('[data-component="composer-editor"]')

  // Select all from the app menu covers the whole window; with focus in the timeline it keeps to the conversation.
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.body))
  await expect(toolbar).toBeVisible()
  await expect
    .poll(() =>
      scroller.evaluate((element) => {
        const range = window.getSelection()?.getRangeAt(0)

        return !!range && element.contains(range.startContainer) && element.contains(range.endContainer)
      }),
    )
    .toBe(true)

  // Over the limit, the action is disabled and Tab moves on as usual.
  await expect(toolbar.getByText("Selection too long", { exact: true })).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "Quote", exact: true })).toBeDisabled()
  await scroller.focus()
  await page.keyboard.press("Tab")
  await expect(scroller).not.toBeFocused()
  await expect(toolbar.getByRole("button", { name: "Quote", exact: true })).not.toBeFocused()

  // Tab from a control inside the timeline keeps its usual order while a quote is offered.
  await page.keyboard.press("Escape")
  await short.evaluate((element) => window.getSelection()?.selectAllChildren(element))
  await expect(toolbar).toBeVisible()
  const copy = page.getByRole("button", { name: "Copy message" })
  await copy.focus()
  await expect(toolbar).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(copy).not.toBeFocused()
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-component="timeline-quote"]'))).toBe(false)
  await expect(composer).toHaveCount(1)
})

function pauseExitAnimations(locator: Locator) {
  return locator.evaluateHandle((element) => {
    const animations: Animation[] = []

    const pause = (event: AnimationEvent) => {
      if (event.target !== element || event.animationName !== "exit") return

      animations.push(...element.getAnimations())
      animations.forEach((animation) => animation.pause())
      element.removeEventListener("animationstart", pause)
    }

    element.addEventListener("animationstart", pause)

    return animations
  })
}

function notes(label: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${label} note ${index + 1}.`).join("\n\n")
}

function searches(from: number, count: number) {
  return Array.from({ length: count }, (_, index) =>
    toolPart(`prt_search_${from + index}`, "grep", "completed", { pattern: `needle_${from + index}` }),
  )
}

function runningSubagent(): SessionMessageAssistant {
  return {
    ...completed,
    content: [
      {
        type: "tool",
        id: "call_subagent",
        name: "subagent",
        state: { status: "running", input: { description: "Inspect code" }, metadata: { status: "running" } },
        time: { created: 2 },
      },
    ],
    time: { created: 2 },
  }
}

function backgroundHint(page: Page) {
  return page.getByRole("button", { name: /move running work to the background/i })
}

async function expectBackgroundRequest(page: Page) {
  const request = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/background`,
  )

  await page.keyboard.press("Control+b")
  await request
}

function patchFile(file: string, status: "added" | "modified" | "deleted") {
  return {
    file,
    status,
    patch: {
      added: "@@ -0,0 +1 @@\n+export const after = true",
      deleted: "@@ -1 +0,0 @@\n-export const before = true",
      modified: "@@ -1 +1 @@\n-export const before = true\n+export const after = true",
    }[status],
    additions: status === "deleted" ? 0 : 1,
    deletions: status === "added" ? 0 : 1,
  }
}

function summaryDiff(index: number) {
  return {
    file: `src/diff-${index}.ts`,
    additions: 1,
    deletions: 1,
    status: "modified" as const,
    patch: `@@ -1 +1 @@\n-export const value = ${index}\n+export const value = ${index + 1}`,
  }
}
