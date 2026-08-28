import { expect, test } from "@playwright/test"
import type { SessionMessageAssistant, ShellInfo } from "@opencode-ai/client/promise"
import { directory, sessionID, setupTimeline } from "../performance/timeline-stability/fixture"

const shell = {
  id: "sh_background",
  status: "running",
  command: "bun run check",
  cwd: directory,
  shell: "bash",
  file: "/tmp/check.out",
  metadata: { sessionID },
  time: { started: 2 },
} satisfies ShellInfo

for (const grouped of [false, true]) {
  for (const status of ["exited", "killed", "timeout"] as const) {
    test(`stops ${grouped ? "grouped" : "standalone"} background shell shimmer when ${status}`, async ({
      page,
    }, info) => {
      const message: SessionMessageAssistant = {
        id: "msg_background",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [shell.id, "sh_other"].map((id) => ({
          type: "tool",
          id: `call_${id}`,
          name: "shell",
          state: {
            status: "completed",
            input: { command: shell.command },
            content: [{ type: "text", text: "Command moved to the background." }],
            metadata: { shellID: id, status: "running" },
          },
          time: { created: 2, completed: 3 },
        })),
        time: { created: 2, completed: 3 },
      }
      if (grouped)
        message.content.unshift({
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
        })
      const timeline = await setupTimeline(page, {
        viewport: { width: grouped ? 390 : 1400, height: 900 },
        settings: { shellToolPartsExpanded: !grouped },
        sessionStatus: { [sessionID]: { type: "busy" } },
        sessionMessages: [
          { id: "msg_user", type: "user", text: "Run two independent checks.", time: { created: 1 } },
          message,
        ],
      })
      const state = { finished: false, requests: 0 }
      await page.route("**/api/shell?*", (route) =>
        route.fulfill({
          json: { location: { directory }, data: [...(state.finished ? [] : [shell]), { ...shell, id: "sh_other" }] },
        }),
      )
      await page.route("**/api/shell/*/output?*", (route) => {
        const url = new URL(route.request().url())
        const target = url.pathname.includes(`/${shell.id}/`)
        if (target) state.requests++
        const output = target && state.finished ? "Checking project\nCheck finished\n" : "Checking project\n"
        const cursor = Number(url.searchParams.get("cursor") ?? 0)
        const end = Math.min(output.length, cursor + 17)
        return route.fulfill({
          json: {
            location: { directory },
            data: {
              output: output.slice(cursor, end),
              cursor: end,
              size: output.length,
              truncated: false,
            },
          },
        })
      })
      await page.clock.install()
      await page.reload()
      await timeline.transport.waitForConnection()
      const group = page.locator('[data-component="collapsed-tool-group"]')
      const groupTrigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
      if (grouped) {
        await expect(group).toHaveAttribute("data-timeline-part-ids", "call_read,call_sh_background,call_sh_other")
        await expect(groupTrigger).toHaveAttribute("aria-expanded", "false")
        await groupTrigger.click()
      }
      const card = page.locator(`[data-timeline-part-id="call_${shell.id}"]`)
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
        data: { id: shell.id, status, exit: status === "exited" ? 0 : 1 },
      })
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")
      await expect(card.locator('[data-slot="bash-result"]')).toHaveText("Checking project\nCheck finished")
      await expect(card.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
      await page.locator("[data-timeline-virtual-content]").screenshot({ path: info.outputPath("shell-finished.png") })

      const requests = state.requests
      await page.clock.fastForward(5_000)
      expect(state.requests).toBe(requests)

      await page.reload()
      if (grouped) await groupTrigger.click()
      await expect(shimmer).toHaveAttribute("data-active", "false")
      await expect(other).toHaveAttribute("data-active", "true")
    })
  }
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
            state: { status: "running", input: { command: shell.command }, metadata: { shellID: shell.id } },
            time: { created: 2 },
          },
        ],
        time: { created: 2 },
      },
    ],
  })
  await page.route("**/api/shell/*/output?*", (route) =>
    route.fulfill({
      json: {
        location: { directory },
        data: {
          output: Number(new URL(route.request().url()).searchParams.get("cursor")) === 0 ? "Checking project\n" : "",
          cursor: 17,
          size: 17,
          truncated: false,
        },
      },
    }),
  )
  await page.reload()
  await timeline.transport.waitForConnection()
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
