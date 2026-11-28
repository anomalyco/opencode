/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir, rename, symlink } from "node:fs/promises"
import path from "node:path"
import { ConfigProvider, resolve, useConfig, type Interface } from "../src/config"
import { tmpdir } from "./fixture/fixture"

// Windows needs elevated rights to create file symlinks.
test.skipIf(process.platform === "win32")("reloads when the target of a symlinked config file changes", async () => {
  await using tmp = await tmpdir()
  const config = path.join(tmp.path, "config")
  const dotfiles = path.join(tmp.path, "dotfiles")
  const target = path.join(dotfiles, "cli.json")
  const link = path.join(config, "cli.json")
  await mkdir(path.join(tmp.path, "staging"))
  await Bun.write(path.join(tmp.path, "staging-dotfiles", "cli.json"), JSON.stringify({ mouse: true }))
  await symlink(target, path.join(tmp.path, "staging", "cli.json"))
  // macOS can report events from just before a watch starts; renaming the directories into place leaves none under them.
  await rename(path.join(tmp.path, "staging"), config)
  await rename(path.join(tmp.path, "staging-dotfiles"), dotfiles)
  const service: Interface = {
    path: link,
    get: () => Bun.file(link).json(),
    update: () => Promise.reject(new Error("unused")),
  }
  let context: ReturnType<typeof useConfig> | undefined

  function Consumer() {
    context = useConfig()
    return <text>config</text>
  }

  const app = await testRender(
    () => (
      <ConfigProvider config={resolve({ mouse: true }, { terminalSuspend: true })} service={service}>
        <Consumer />
      </ConfigProvider>
    ),
    { width: 40, height: 5 },
  )
  try {
    await app.renderOnce()
    // The watch may start after the first write, so write again until it reloads.
    const deadline = Date.now() + 5_000
    while (context?.data.mouse !== false && Date.now() < deadline) {
      await Bun.write(target, JSON.stringify({ mouse: false }))
      await Bun.sleep(100)
    }
    expect(context?.data.mouse).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})
