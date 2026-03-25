import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../fixture/fixture"
import { mockTuiRuntime } from "../../fixture/tui-runtime"
import { createTuiPluginApi } from "../../fixture/tui-plugin"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("api.client tracks runtime client rebinds", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginPath = path.join(dir, "rebind-plugin.ts")
      const pluginSpec = pathToFileURL(pluginPath).href
      const marker = path.join(dir, "rebind-marker.json")

      await Bun.write(
        pluginPath,
        `export default {
  tui: async (api, options) => {
    const one = api.client.global
    const one_scoped = api.scopedClient(options.workspace_id)
    api.workspace.set(options.workspace_id)
    const two = api.client.global
    const two_scoped = api.scopedClient(options.workspace_id)
    await Bun.write(
      options.marker,
      JSON.stringify({
        rebound: one !== two,
        scoped_ok: !!one_scoped && !!two_scoped,
      }),
    )
  },
}
`,
      )

      return {
        marker,
        pluginSpec,
      }
    },
  })

  const restore = mockTuiRuntime(tmp.path, [[tmp.extra.pluginSpec, { marker: tmp.extra.marker, workspace_id: "ws_1" }]])
  const local = createOpencodeClient({ baseUrl: "http://localhost:4096" })
  const scoped = createOpencodeClient({
    baseUrl: "http://localhost:4096",
    experimental_workspaceID: "ws_1",
  })
  let cur = local

  try {
    await TuiPluginRuntime.init(
      createTuiPluginApi({
        client: () => cur,
        scopedClient: (_workspaceID?: string) => scoped,
        workspace: {
          current: () => undefined,
          set: (workspaceID) => {
            cur = workspaceID ? scoped : local
          },
        },
      }),
    )

    const hit = JSON.parse(await fs.readFile(tmp.extra.marker, "utf8")) as {
      rebound: boolean
      scoped_ok: boolean
    }

    expect(hit.rebound).toBe(true)
    expect(hit.scoped_ok).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})
