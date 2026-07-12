import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { expect, test } from "bun:test"
import path from "path"
import { TuiConfig } from "../src/tui-config"

test("loads the global tui config", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(path.join(directory, "tui.json"), JSON.stringify({ keybinds: { leader: "ctrl+o" } }))

  try {
    const config = await Effect.runPromise(
      TuiConfig.load().pipe(
        Effect.provide(Global.layerWith({ config: directory })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )

    expect(config.keybinds.get("leader")?.[0]?.key).toBe("ctrl+o")
    expect(config.keybinds.get("session.new")?.[0]?.key).toBe("<leader>n")
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})
