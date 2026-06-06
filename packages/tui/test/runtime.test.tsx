import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  abbreviateHome,
  createTuiBuildInfo,
  createTuiEnvironment,
  TuiBuildInfoProvider,
  TuiEnvironmentProvider,
  useTuiBuildInfo,
  useTuiEnvironment,
} from "../src/runtime"

test("abbreviates paths within home boundaries", () => {
  expect(abbreviateHome("/home/test", "/home/test")).toBe("~")
  expect(abbreviateHome("/home/test/project", "/home/test")).toBe("~/project")
  expect(abbreviateHome("/home/tester/project", "/home/test")).toBe("/home/tester/project")
  expect(abbreviateHome("/tmp/project", "/home/test")).toBe("/tmp/project")
})

test("provides immutable runtime inputs", async () => {
  const environment = createTuiEnvironment({
    cwd: "/work",
    platform: "linux",
    paths: { home: "/home/test", state: "/state", worktree: "/data/worktree" },
    capabilities: {
      mouse: true,
      copyOnSelect: true,
      terminalTitle: true,
      terminalSuspend: true,
      workspaces: false,
      showTimeToFirstDraw: false,
    },
    terminal: { multiplexer: "tmux", displayServer: "wayland" },
    editor: { command: "vim", port: 4242, zedTerminal: false },
    skipInitialLoading: false,
  })
  const build = createTuiBuildInfo({ version: "1.2.3", channel: "beta" })

  function Runtime() {
    const runtime = useTuiEnvironment()
    const info = useTuiBuildInfo()
    return <text>{`${runtime.cwd} ${runtime.editor.command} ${info.version}`}</text>
  }

  const app = await testRender(
    () => (
      <TuiEnvironmentProvider value={environment}>
        <TuiBuildInfoProvider value={build}>
          <Runtime />
        </TuiBuildInfoProvider>
      </TuiEnvironmentProvider>
    ),
    { width: 40, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("/work vim 1.2.3")
    expect(Object.isFrozen(environment)).toBe(true)
    expect(Object.isFrozen(environment.paths)).toBe(true)
    expect(Object.isFrozen(build)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
