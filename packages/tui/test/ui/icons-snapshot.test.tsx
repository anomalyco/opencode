/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createStore } from "solid-js/store"
import { InlineToolRow } from "../../src/routes/session"
import { PromptFooter } from "../../src/feature-plugins/prompt/footer"
import { SidebarOnboarding } from "../../src/feature-plugins/sidebar/footer"
import { icon, setIconMode, type ResolvedIconMode } from "../../src/ui/design"

const profiles: ReadonlyArray<{ name: string; mode: ResolvedIconMode }> = [
  { name: "opencode", mode: "ascii" },
  { name: "fork+nerd", mode: "nerd" },
  { name: "fork+ascii", mode: "ascii" },
]

afterEach(() => setIconMode("ascii"))

const color = RGBA.fromInts(200, 200, 200)
const muted = RGBA.fromInts(100, 100, 100)

function statusContext(): Context {
  return {
    location: { directory: "/workspace" },
    theme: { text: { base: color, muted } },
    keymap: { shortcuts: () => [], dispatch: () => {} },
    client: {
      rpc: () => ({
        get: () =>
          Promise.resolve({
            id: "goal",
            objective: "Ship the icon abstraction",
            status: "active",
            rounds: 1,
            maxRounds: 50,
            boot: "boot",
            updatedAt: 0,
          }),
        events: { on: () => () => {} },
      }),
    },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session"],
        status: () => "idle",
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 0,
        message: { list: () => [] },
      },
      job: { list: () => [] },
      shell: { list: () => [{ metadata: { sessionID: "session" } }] },
      location: { model: { list: () => [] } },
    },
  } as unknown as Context
}

function sidebarContext(): Context {
  const [onboarding, update] = createStore({ dismissed: false })
  return {
    location: { directory: "/workspace" },
    theme: { background: { raised: { high: color } }, text: { base: color, muted } },
    storage: { store: () => [onboarding, () => Promise.resolve(update)] },
    keymap: { dispatch: () => {} },
    ui: { format: { path: (value: string) => value } },
    data: {
      session: { get: () => ({ location: { directory: "/workspace" } }) },
      location: { integration: { list: () => [] }, vcs: { info: () => undefined } },
    },
  } as unknown as Context
}

for (const profile of profiles) {
  test(`${profile.name} statusline`, async () => {
    setIconMode(profile.mode)
    const app = await testRender(
      () => <PromptFooter context={statusContext()} sessionID="session" mode="normal" showDetails={true} />,
      { width: 80, height: 2 },
    )
    try {
      await Promise.resolve()
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame().trimEnd()).toMatchSnapshot()
    } finally {
      app.renderer.destroy()
    }
  })

  test(`${profile.name} tool rows`, async () => {
    setIconMode(profile.mode)
    const app = await testRender(
      () => (
        <box flexDirection="column" width={72}>
          <InlineToolRow icon={icon("glob", profile.mode)} complete pending="Finding files…">
            Glob "**/*.ts" in packages/tui
          </InlineToolRow>
          <InlineToolRow icon={icon("read", profile.mode)} complete pending="Reading file…">
            Read packages/tui/src/ui/design.ts
          </InlineToolRow>
          <InlineToolRow
            icon={icon("cross", profile.mode)}
            complete
            pending="Running tests…"
            failed
            error="bun test exited with code 1"
          >
            Shell bun test
          </InlineToolRow>
        </box>
      ),
      { width: 72, height: 5 },
    )
    try {
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame().trimEnd()).toMatchSnapshot()
    } finally {
      app.renderer.destroy()
    }
  })

  test(`${profile.name} sidebar`, async () => {
    setIconMode(profile.mode)
    const app = await testRender(
      () => (
        <box width={38}>
          <SidebarOnboarding context={sidebarContext()} sessionID="session" />
        </box>
      ),
      { width: 38, height: 22 },
    )
    try {
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame().trimEnd()).toMatchSnapshot()
    } finally {
      app.renderer.destroy()
    }
  })
}
