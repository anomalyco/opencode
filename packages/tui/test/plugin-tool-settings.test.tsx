import { expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test("plugins can register settings and decorate built-in shell tool cards reactively", async () => {
  await using plugin = await copyPlugin("tool-settings")
  const session = {
    id: `ses_tool_settings_${crypto.randomUUID()}`,
    title: "Tool settings",
    projectID: "proj_tool_settings",
    location: { directory },
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  } satisfies SessionInfo
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Check shell", time: { created: 1 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: 2, completed: 3 },
      content: [
        {
          type: "tool",
          id: "call_pwsh",
          name: "shell",
          time: { created: 2, completed: 3 },
          state: {
            input: { command: "Write-Output ok", workdir: "/tmp/demo-dir", shell: "pwsh" },
            status: "completed",
            content: [{ type: "text", text: "ok" }],
            metadata: { exit: 0, truncated: false, shell: "pwsh" },
          },
        },
        { type: "text", text: "Done checking" },
      ],
    },
  ]

  await using setup = await createAppFixture({
    width: 120,
    height: 40,
    args: { sessionID: session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      session: { sidebar: "hide", verbosity: "high" },
      plugins: [{ package: plugin.directory }],
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
        return json({ data: [] })
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("# pwsh in /tmp/demo-dir"))
  const initialLines = setup.captureCharFrame().split("\n")
  const headerLine = initialLines.findIndex((line) => line.includes("# pwsh in /tmp/demo-dir"))
  expect(headerLine).toBeGreaterThanOrEqual(0)
  expect(initialLines[headerLine + 1]).toContain("$ Write-Output ok")
  expect(setup.captureCharFrame()).not.toContain("cd /tmp/demo-dir &&")

  // Open Settings dialog and toggle the plugin-registered Workdir setting live.
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Open settings"))
  await setup.mockInput.typeText("Open settings")
  await setup.waitForFrame((frame) => frame.includes("Open settings"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Settings") && frame.includes("Appearance"))
  await setup.mockInput.typeText("Workdir")
  await setup.waitForFrame((frame) => frame.includes("Shell") && frame.includes("Workdir") && frame.includes("header"))
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("command (cd)"))
  setup.mockInput.pressEscape()

  await setup.waitForFrame((frame) => frame.includes("$ cd /tmp/demo-dir && Write-Output ok"))
  const updated = setup.captureCharFrame()
  expect(updated).toContain("# pwsh")
  expect(updated).not.toContain("# pwsh in /tmp/demo-dir")
})
