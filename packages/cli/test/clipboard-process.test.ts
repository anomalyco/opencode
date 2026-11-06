import { expect, test } from "bun:test"
import path from "node:path"
import { createClipboardProcess } from "@opencode/tui/clipboard-process"
import os from "node:os"
import { access, mkdtemp, rm } from "node:fs/promises"

test("clipboard helper failures bypass normal CLI startup and propagate to the caller", async () => {
  const clipboard = createClipboardProcess([process.execPath, path.resolve(import.meta.dir, "../src/index.ts")])
  try {
    await expect(
      clipboard.write("clipboard helper fixture", {
        ...process.env,
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
        XDG_RUNTIME_DIR: undefined,
        OPENCODE_SSH_ASKPASS_PORT: "1",
      }),
    ).rejects.toThrow("Desktop clipboard write unsupported")
  } finally {
    await clipboard.dispose()
  }
}, 30_000)

test("reuses a helper for ordered copies and replaces it when X authority changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-clipboard-reuse-"))
  const file = path.join(dir, "request.json")
  const clipboard = createClipboardProcess([
    process.execPath,
    path.join(import.meta.dir, "fixture/clipboard-process.ts"),
  ])
  const env = { ...process.env, OPENCODE_CLIPBOARD_FIXTURE: file, DISPLAY: "localhost:20.0", XAUTHORITY: "/first" }
  try {
    await clipboard.write("first", env)
    const first = await Bun.file(file).json()
    await Promise.all([clipboard.write("second", env), clipboard.write("third\n世界", env)])
    const reused = await Bun.file(file).json()
    expect(reused.pid).toBe(first.pid)
    expect(reused.count).toBe(3)
    expect(reused.text).toBe("third\n世界")
    await clipboard.write("new authority", { ...env, XAUTHORITY: "/second" })
    const replaced = await Bun.file(file).json()
    expect(replaced.pid).not.toBe(first.pid)
    expect(replaced.count).toBe(1)
  } finally {
    await clipboard.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)

test.skipIf(process.platform !== "linux")(
  "replaces the clipboard owner and releases it when its tmux client exits",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-clipboard-process-"))
    const file = path.join(dir, "request.json")
    const client = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const clipboard = createClipboardProcess([
      process.execPath,
      path.join(import.meta.dir, "fixture/clipboard-process.ts"),
    ])
    const gone = async (pid: number) => {
      const deadline = Date.now() + 5000
      while (
        await access(`/proc/${pid}`).then(
          () => true,
          () => false,
        )
      ) {
        if (Date.now() > deadline) throw new Error(`Clipboard owner ${pid} did not exit`)
        await Bun.sleep(20)
      }
    }
    try {
      const env = { ...process.env, OPENCODE_CLIPBOARD_FIXTURE: file, DISPLAY: "localhost:20.0" }
      await clipboard.write("first\n世界", env, client.pid)
      const first = await Bun.file(file).json()
      expect(first.text).toBe("first\n世界")
      expect(first.display).toBe("localhost:20.0")
      await clipboard.write("second", { ...env, DISPLAY: "localhost:21.0" }, client.pid)
      const second = await Bun.file(file).json()
      expect(second.text).toBe("second")
      expect(second.display).toBe("localhost:21.0")
      expect(second.pid).not.toBe(first.pid)
      await gone(first.pid)
      client.kill()
      await client.exited
      await gone(second.pid)
    } finally {
      client.kill()
      await clipboard.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  },
  30_000,
)

test("an empty clipboard helper closes without starting a server or TUI", async () => {
  const child = Bun.spawn(
    [process.execPath, "--cwd", path.resolve(import.meta.dir, ".."), path.resolve(import.meta.dir, "../src/index.ts")],
    {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        OPENCODE_CLIPBOARD_HELPER: "1",
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
        XDG_RUNTIME_DIR: undefined,
      },
      stdin: new Blob([]),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  expect(await child.exited).toBe(0)
  expect(await new Response(child.stdout).text()).toBe("")
  expect(await new Response(child.stderr).text()).toBe("")
}, 30_000)
