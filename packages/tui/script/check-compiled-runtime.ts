import assert from "node:assert/strict"
import path from "node:path"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { tmpdir } from "../test/fixture/fixture"
import { createEventStream, createFetch, json } from "../test/fixture/tui-client"
import { installRuntimePeer } from "../test/fixture/runtime-peer"

const binary = process.env.OPENCODE_RUNTIME_CLI
if (!binary || process.platform === "win32") throw new Error("Set OPENCODE_RUNTIME_CLI to a native POSIX executable")
if (binary && (await Bun.file(binary).slice(0, 2).text()) === "#!")
  throw new Error("OPENCODE_RUNTIME_CLI must be a native executable, not a profile launcher")

// Boots the actual default CLI through a PTY. The fake server is local and all
// user directories are private. No providers, credentials or live service.
await using root = await tmpdir()
const peer = await installRuntimePeer(root.path)
for (const native of [false, true]) {
  await peer.entry(native)
  await runCLI(peer.consumer, peer.wrapper)
}
console.log("Compiled CLI runtime check passed")

async function runCLI(consumer: string, plugin: string) {
  const { spawn } = await import("../../core/node_modules/bun-pty")
  const session = {
    id: "ses_runtime_test",
    title: "Compiled runtime",
    projectID: "project",
    location: { directory: consumer },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname.endsWith("/message") || url.pathname.endsWith("/inbox")) return json({ data: [], cursor: {} })
    return undefined
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const output = await createTestRenderer({ width: 110, height: 30, useThread: false, remote: true })
  const child = spawn(binary!, ["--server", server.url.toString(), "--session", session.id], {
    name: "xterm-256color",
    cols: 110,
    rows: 30,
    cwd: consumer,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
      HOME: consumer,
      OPENCODE_TEST_HOME: consumer,
      XDG_CONFIG_HOME: path.join(consumer, "config"),
      XDG_DATA_HOME: path.join(consumer, "data"),
      XDG_STATE_HOME: path.join(consumer, "state"),
      XDG_CACHE_HOME: path.join(consumer, "cache"),
      OPENCODE_CONFIG_DIR: path.join(consumer, "config"),
      OPENCODE_CONFIG_CONTENT: "{}",
      OPENCODE_DB: path.join(consumer, "isolated.sqlite"),
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ animations: false, tabs: { mode: "off" }, plugins: [plugin] }),
    },
  })
  const terminal = new EmbeddedTerminalRenderable(output.renderer, {
    id: "compiled-cli",
    width: 110,
    height: 30,
    cols: 110,
    rows: 30,
    onData: (data) => child.write(Buffer.from(data).toString("utf8")),
  })
  output.renderer.root.add(terminal)
  let exited = false
  const exit = Promise.withResolvers<void>()
  const data = child.onData((text) => terminal.write(text))
  const done = child.onExit(() => {
    exited = true
    exit.resolve()
  })
  async function frame(text: string) {
    const deadline = Date.now() + 15_000
    while (!exited && Date.now() < deadline) {
      await output.renderOnce()
      if (terminal.screen().text.includes(text)) return
      await Bun.sleep(10)
    }
    throw new Error(`Production CLI missing ${text}; exited=${exited}\n${terminal.screen().text}`)
  }
  async function waitExit() {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      exit.promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_000)
      }),
    ])
    clearTimeout(timer)
    return exited
  }
  try {
    await frame("Shared runtime 0")
    await frame("ctrl+p commands")
    child.write("\x13")
    await frame("Shared runtime 1")
  } finally {
    child.write("\x03")
    if (!(await waitExit())) {
      const group = Number(
        Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(child.pid)])
          .stdout.toString()
          .trim(),
      )
      const parent = Number(
        Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(process.pid)])
          .stdout.toString()
          .trim(),
      )
      if (group > 1 && group !== parent) {
        process.kill(-group, "SIGTERM")
        if (!(await waitExit())) process.kill(-group, "SIGKILL")
      }
      assert.ok(await waitExit(), "native CLI must exit during cleanup")
    }
    data.dispose()
    done.dispose()
    output.renderer.destroy()
    await server.stop(true)
  }
}
