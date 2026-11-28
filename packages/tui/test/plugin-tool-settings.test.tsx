import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { copyPlugin, tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

async function runPaletteCommand(setup: Awaited<ReturnType<typeof createAppFixture>>, title: string) {
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Commands"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText(title)
  await setup.waitForFrame((frame) => frame.includes(title))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes("Commands"))
}

function createShellFixture() {
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
  return {
    session,
    fetch: (url: URL) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
        return json({ data: [] })
    },
  }
}

async function writePlugin(name: string, source: string) {
  const root = await tmpdir()
  const directory = path.join(root.path, name)
  const entry = path.join(directory, "tui.tsx")
  await mkdir(directory)
  await symlink(path.join(import.meta.dir, "../node_modules"), path.join(directory, "node_modules"))
  await Bun.write(entry, source)
  return { directory, entry, [Symbol.asyncDispose]: root[Symbol.asyncDispose] }
}

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

test("re-decorating shell within one plugin keeps the newer decorator when the earlier handle unregisters", async () => {
  await using plugin = await writePlugin(
    "redecorate",
    `import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.redecorate",
  setup(context) {
    const stale = context.ui.tools.decorate("shell", () => ({ title: "# stale-shell" }))
    const first = context.ui.tools.decorate("shell", () => ({ title: "# first-shell" }))
    stale()
    const second = context.ui.tools.decorate("shell", () => ({ title: "# second-shell" }))

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "fixture.drop-first",
          title: "Drop first decorator",
          palette: true,
          run: () => first(),
        },
        {
          id: "fixture.drop-second",
          title: "Drop second decorator",
          palette: true,
          run: () => second(),
        },
      ],
    }))
  },
})
`,
  )
  const fixture = createShellFixture()
  await using setup = await createAppFixture({
    width: 120,
    height: 40,
    args: { sessionID: fixture.session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      session: { sidebar: "hide", verbosity: "high" },
      plugins: [{ package: plugin.directory }],
    },
    fetch: fixture.fetch,
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("# second-shell") && frame.includes("ctrl+p commands"))
  expect(setup.captureCharFrame()).not.toContain("# first-shell")
  expect(setup.captureCharFrame()).not.toContain("# stale-shell")

  // Unregistering the earlier handle must not remove the newer active decorator.
  await runPaletteCommand(setup, "Drop first decorator")
  expect(setup.captureCharFrame()).toContain("# second-shell")

  // Unregistering the second handle leaves no active decorator (stale was already unregistered in setup).
  await runPaletteCommand(setup, "Drop second decorator")
  await setup.waitForFrame((frame) => !frame.includes("# second-shell"))
  expect(setup.captureCharFrame()).not.toContain("# first-shell")
  expect(setup.captureCharFrame()).not.toContain("# stale-shell")
})

test("cross-plugin shell decorators follow registration order instead of plugin registration-map order", async () => {
  await using pluginB = await writePlugin(
    "plugin-b",
    `import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.plugin-b",
  setup(context) {
    context.ui.tools.decorate("shell", () => ({ title: "# from-b-initial" }))
    let later: (() => void) | undefined
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "fixture.register-b-later",
          title: "Register B later",
          palette: true,
          run: () => {
            later = context.ui.tools.decorate("shell", () => ({ title: "# from-b-later" }))
          },
        },
        {
          id: "fixture.drop-b-later",
          title: "Drop B later",
          palette: true,
          run: () => later?.(),
        },
      ],
    }))
  },
})
`,
  )
  await using pluginA = await writePlugin(
    "plugin-a",
    `import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.plugin-a",
  setup(context) {
    const off = context.ui.tools.decorate("shell", () => ({ title: "# from-a" }))
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "fixture.drop-a",
          title: "Drop A decorator",
          palette: true,
          run: () => off(),
        },
      ],
    }))
  },
})
`,
  )
  const fixture = createShellFixture()
  await using setup = await createAppFixture({
    width: 120,
    height: 40,
    args: { sessionID: fixture.session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      session: { sidebar: "hide", verbosity: "high" },
      plugins: [{ package: pluginB.directory }, { package: pluginA.directory }],
    },
    fetch: fixture.fetch,
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("# from-a") && frame.includes("ctrl+p commands"))
  await setup.renderOnce()

  // Registering another decorator from plugin B makes B the latest active writer even though A comes after B in store.registrations.
  await runPaletteCommand(setup, "Register B later")
  await setup.waitForFrame((frame) => frame.includes("# from-b-later"))

  // Dropping the later B decorator falls back to A.
  await runPaletteCommand(setup, "Drop B later")
  await setup.waitForFrame((frame) => frame.includes("# from-a"))

  // Dropping A falls back to B's initial decorator.
  await runPaletteCommand(setup, "Drop A decorator")
  await setup.waitForFrame((frame) => frame.includes("# from-b-initial"))
})

test("a plugin setting whose value or format throws does not break the Settings dialog", async () => {
  await using plugin = await writePlugin(
    "broken-settings",
    `import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

export default Plugin.define({
  id: "fixture.broken-settings",
  setup(context) {
    const [working, setWorking] = createSignal<"alpha" | "beta">("alpha")

    context.ui.settings.register({
      id: "broken_value",
      title: "Broken value",
      category: "Faulty",
      description: "Throws from value()",
      value: () => {
        throw new Error("boom value")
      },
      values: ["a", "b"],
      onChange: () => {},
    })

    context.ui.settings.register({
      id: "broken_format",
      title: "Broken format",
      category: "Faulty",
      description: "Throws from format()",
      value: () => "ok",
      values: ["ok", "next"],
      format: () => {
        throw new Error("boom format")
      },
      onChange: () => {},
    })

    context.ui.settings.register({
      id: "working",
      title: "Working setting",
      category: "Faulty",
      description: "Continues working",
      value: working,
      values: ["alpha", "beta"],
      onChange: (next) => setWorking(next === "beta" ? "beta" : "alpha"),
    })
  },
})
`,
  )
  const fixture = createShellFixture()
  await using setup = await createAppFixture({
    width: 120,
    height: 40,
    args: { sessionID: fixture.session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      session: { sidebar: "hide", verbosity: "high" },
      plugins: [{ package: plugin.directory }],
    },
    fetch: fixture.fetch,
  })

  await setup.ready
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Open settings"))
  await setup.mockInput.typeText("Open settings")
  await setup.waitForFrame((frame) => frame.includes("Open settings"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Settings") && frame.includes("Appearance"))

  await setup.mockInput.typeText("Faulty")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Broken value") &&
      frame.includes("Broken format") &&
      frame.includes("Working setting") &&
      frame.includes("alpha"),
  )
  const frame = setup.captureCharFrame()
  expect(frame).toContain("error")

  // Interacting with broken settings must not crash or wedge saving state.
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((next) => next.includes("beta"))
})
