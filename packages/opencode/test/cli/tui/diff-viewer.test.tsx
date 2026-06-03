/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { Global } from "@opencode-ai/core/global"
import type { TuiPluginApi, TuiPluginMeta, TuiRouteCurrent, TuiRouteDefinition } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { KVProvider } from "../../../src/cli/cmd/tui/context/kv"
import { ThemeProvider } from "../../../src/cli/cmd/tui/context/theme"
import { TuiConfigProvider } from "../../../src/cli/cmd/tui/context/tui-config"
import { OpencodeKeymapProvider } from "../../../src/cli/cmd/tui/keymap"
import diffViewerPlugin from "../../../src/cli/cmd/tui/feature-plugins/system/diff-viewer"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("closing the diff viewer returns to the route it opened from", async () => {
  const startRoute: TuiRouteCurrent = { name: "session", params: { sessionID: "session-1" } }
  const commands = new Map<
    string,
    NonNullable<Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]["commands"]>[number]
  >()
  let current = startRoute
  let renderDiff: TuiRouteDefinition["render"] | undefined
  let vcsDiffInput: unknown
  await mkdir(Global.Path.state, { recursive: true })
  await Bun.write(path.join(Global.Path.state, "kv.json"), "{}")

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const registerLayer = keymap.registerLayer.bind(keymap)
    keymap.registerLayer = (layer) => {
      layer.commands?.forEach((command) => commands.set(command.name, command))
      return registerLayer(layer)
    }
    const base = createTuiPluginApi({
      keymap,
      client: {
        vcs: {
          diff: async (input: unknown) => {
            vcsDiffInput = input
            return { data: [] }
          },
        },
        session: { diff: async () => ({ data: [] }) },
      } as unknown as TuiPluginApi["client"],
      state: {
        session: {
          get: () => session,
        },
      },
    })
    const api = {
      ...base,
      route: {
        register(routes) {
          renderDiff = routes.find((route) => route.name === "diff")?.render
          return () => {}
        },
        navigate(name, params) {
          current = params ? { name, params } : { name }
        },
        get current() {
          return current
        },
      },
    } satisfies TuiPluginApi

    void diffViewerPlugin.tui(api, undefined, pluginMeta)
    commands.get("diff.open")?.run?.({} as never)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {renderDiff?.({ params: "params" in current ? current.params : undefined })}
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20 })
  try {
    await waitForCommand(app, commands, "diff.close")
    expect(current).toEqual({ name: "diff", params: { mode: "git", sessionID: "session-1", returnRoute: startRoute } })
    expect(vcsDiffInput).toEqual({ directory: "/repo/session", mode: "git", context: 12 })

    expect(commands.has("diff.close")).toBe(true)
    commands.get("diff.close")!.run?.({} as never)
    expect(current).toEqual(startRoute)
  } finally {
    app.renderer.destroy()
  }
})

const session = {
  id: "session-1",
  slug: "session-1",
  projectID: "project-1",
  directory: "/repo/session",
  title: "Session",
  version: "1",
  time: {
    created: 0,
    updated: 0,
  },
} satisfies Session

async function waitForCommand(
  app: Awaited<ReturnType<typeof testRender>>,
  commands: Map<string, unknown>,
  command: string,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await app.renderOnce()
    if (commands.has(command)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const pluginMeta = {
  id: "diff-viewer",
  source: "internal",
  spec: "diff-viewer",
  target: "diff-viewer",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
} satisfies TuiPluginMeta
