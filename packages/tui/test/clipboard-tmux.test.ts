import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createTmuxClipboard, tmuxClipboardTarget } from "../src/clipboard/tmux"

test.skipIf(process.platform !== "linux" || !Bun.which("tmux") || !Bun.which("script"))(
  "copies to an attached tmux client with default passthrough settings",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-clipboard-"))
    const socket = path.join(dir, "tmux.sock")
    const run = (args: string[]) =>
      Bun.spawnSync(["tmux", "-S", socket, ...args], {
        env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined },
      })
    const pane = new TextDecoder()
      .decode(run(["-f", "/dev/null", "new-session", "-d", "-s", "copy", "-P", "-F", "#{pane_id}", "sleep 60"]).stdout)
      .trim()
    const attach = (term = "xterm-256color", env: NodeJS.ProcessEnv = {}) => {
      const proc = Bun.spawn(
        ["script", "-q", "-c", `tmux -S '${socket.replaceAll("'", "'\''")}' attach -t copy`, "/dev/null"],
        {
          env: { ...process.env, SSH_CONNECTION: "fixture", TERM: term, TMUX: undefined, TMUX_PANE: undefined, ...env },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        },
      )
      return { proc, output: new Response(proc.stdout).text() }
    }
    const connected = async () => {
      const deadline = Date.now() + 5000
      while (!new TextDecoder().decode(run(["list-clients", "-F", "#{client_tty}"]).stdout).trim()) {
        if (Date.now() > deadline) throw new Error("tmux client did not attach")
        await Bun.sleep(10)
      }
    }
    const clients = [attach()]
    try {
      await connected()
      expect(new TextDecoder().decode(run(["show-options", "-g", "allow-passthrough"]).stdout).trim()).toBe(
        "allow-passthrough off",
      )
      const clipboard = createTmuxClipboard(
        {
          read: async () => undefined,
          write: async () => {
            throw new Error("must not copy to the original host or use OSC 52 passthrough")
          },
          dispose: async () => {},
        },
        { ...process.env, TMUX: `${socket},0,0`, TMUX_PANE: pane },
      )
      expect(await clipboard.write("reattached\0 client\n世界")).toBe("attempted")
      expect(new TextDecoder().decode(run(["save-buffer", "-"]).stdout)).toBe("reattached client\n世界")

      run(["detach-client", "-s", "copy"])
      await expect(clipboard.write("no client")).rejects.toThrow("No tmux client is attached")
      expect(await clients[0].output).toContain(Buffer.from("reattached client\n世界").toString("base64"))

      // Reuse the original clipboard service after attaching a different client.
      clients.push(attach())
      await connected()
      await clipboard.write("second client")
      run(["detach-client", "-s", "copy"])
      expect(await clients[1].output).toContain(Buffer.from("second client").toString("base64"))
      expect(await clients[0].output).not.toContain(Buffer.from("second client").toString("base64"))

      clients.push(attach("vt100"))
      await connected()
      await expect(clipboard.write("unsupported terminal")).rejects.toThrow("does not advertise clipboard support")

      const writes: { text: string; display?: string; wayland?: string }[] = []
      const native = createTmuxClipboard(
        clipboard,
        { TMUX: `${socket},0,0`, TMUX_PANE: pane, DISPLAY: ":999" },
        {
          async write(text, env) {
            writes.push({ text, display: env.DISPLAY, wayland: env.WAYLAND_DISPLAY })
          },
          async dispose() {},
        },
      )
      run(["detach-client", "-s", "copy"])
      clients.push(attach("vt100", { SSH_CONNECTION: "fixture", DISPLAY: "localhost:20.0", WAYLAND_DISPLAY: "stale" }))
      await connected()
      expect(await native.write("forwarded\0 text")).toBe("written")
      expect(writes).toEqual([{ text: "forwarded text", display: "localhost:20.0", wayland: undefined }])

      run(["detach-client", "-s", "copy"])
      clients.push(attach("vt100", { SSH_CONNECTION: "fixture", DISPLAY: "localhost:21.0", WAYLAND_DISPLAY: "stale" }))
      await connected()
      expect(await native.write("reconnected")).toBe("written")
      expect(writes.at(-1)).toEqual({ text: "reconnected", display: "localhost:21.0", wayland: undefined })

      run(["detach-client", "-s", "copy"])
      clients.push(
        attach("vt100", {
          SSH_CONNECTION: undefined,
          SSH_TTY: undefined,
          DISPLAY: ":22",
          WAYLAND_DISPLAY: "wayland-local",
        }),
      )
      await connected()
      expect(await native.write("local desktop")).toBe("written")
      expect(writes.at(-1)).toEqual({ text: "local desktop", display: ":22", wayland: "wayland-local" })

      // Even vt100 without a clipboard feature can use the unchanged local backend.
      const local = createTmuxClipboard(
        { read: async () => undefined, write: async () => "written" as const, dispose: async () => {} },
        {
          ...process.env,
          TMUX: `${socket},0,0`,
          TMUX_PANE: pane,
          DISPLAY: ":22",
          WAYLAND_DISPLAY: "wayland-local",
          SSH_CONNECTION: undefined,
          SSH_TTY: undefined,
        },
        {
          write: async () => {
            throw new Error("local copies must not start a helper")
          },
          dispose: async () => {},
        },
      )
      expect(await local.write("native local fallback")).toBe("written")

      run(["detach-client", "-s", "copy"])
      clients.push(attach("xterm-256color", { SSH_CONNECTION: "fixture", DISPLAY: ":0", WAYLAND_DISPLAY: "stale" }))
      await connected()
      expect(await native.write("plain ssh")).toBe("attempted")
      expect(writes).toHaveLength(3)
    } finally {
      run(["kill-server"])
      clients.forEach((client) => client.proc.kill())
      await Promise.all(clients.map((client) => client.proc.exited))
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test("keeps the normal clipboard outside tmux", () => {
  const clipboard = {
    read: async () => undefined,
    write: async () => "written" as const,
    dispose: async () => {},
  }
  expect(createTmuxClipboard(clipboard, {})).toBe(clipboard)
})

test("uses an explicitly forwarded display outside tmux, without using the remote desktop", async () => {
  const writes: { text: string; display?: string; wayland?: string }[] = []
  const clipboard = {
    read: async () => undefined,
    write: async () => "attempted" as const,
    dispose: async () => {},
  }
  const host = {
    async write(text: string, env: NodeJS.ProcessEnv) {
      writes.push({ text, display: env.DISPLAY, wayland: env.WAYLAND_DISPLAY })
    },
    async dispose() {},
  }
  const native = createTmuxClipboard(
    clipboard,
    { SSH_CONNECTION: "fixture", DISPLAY: "localhost:10.0", WAYLAND_DISPLAY: "stale" },
    host,
  )
  expect(await native.write("direct\0 SSH")).toBe("written")
  expect(writes).toEqual([{ text: "direct SSH", display: "localhost:10.0", wayland: undefined }])
  expect(createTmuxClipboard(clipboard, { SSH_CONNECTION: "fixture", DISPLAY: ":0" }, host)).toBe(clipboard)
  expect(createTmuxClipboard(clipboard, { SSH_CONNECTION: "fixture" }, host)).toBe(clipboard)
  const failed = createTmuxClipboard(
    clipboard,
    { SSH_CONNECTION: "fixture", DISPLAY: "localhost:10.0" },
    {
      ...host,
      write: async () => {
        throw new Error("Forwarded display disconnected")
      },
    },
  )
  await expect(failed.write("must not claim success")).rejects.toThrow("Forwarded display disconnected")
})

test.each([
  {
    name: "unavailable client environment preserves the original backend",
    env: { DISPLAY: ":0" },
    attached: undefined,
    target: "original",
  },
  { name: "local macOS tmux preserves its native backend", env: {}, attached: undefined, target: "original" },
  {
    name: "remote startup without proc uses tmux OSC 52",
    env: { SSH_CONNECTION: "fixture" },
    attached: undefined,
    target: "terminal",
  },
  {
    name: "unchanged local desktop avoids a helper",
    env: { DISPLAY: ":0" },
    attached: { DISPLAY: ":0" },
    target: "original",
  },
  {
    name: "unchanged Wayland desktop avoids a helper",
    env: { WAYLAND_DISPLAY: "wayland-0" },
    attached: { WAYLAND_DISPLAY: "wayland-0" },
    target: "original",
  },
  {
    name: "another local desktop needs its own environment",
    env: { DISPLAY: ":0" },
    attached: { DISPLAY: ":1" },
    target: "host",
  },
  {
    name: "changed X authority needs its own environment",
    env: { DISPLAY: ":0", XAUTHORITY: "/old" },
    attached: { DISPLAY: ":0", XAUTHORITY: "/new" },
    target: "host",
  },
  {
    name: "forwarded X11 uses the helper",
    env: { DISPLAY: ":0" },
    attached: { SSH_CONNECTION: "fixture", DISPLAY: "localhost:10.0" },
    target: "host",
  },
  {
    name: "ordinary SSH must not write to the old desktop",
    env: { DISPLAY: ":0" },
    attached: { SSH_CONNECTION: "fixture", DISPLAY: ":0" },
    target: "terminal",
  },
  {
    name: "SSH without a display uses the terminal",
    env: { DISPLAY: ":0" },
    attached: { SSH_TTY: "/dev/pts/1" },
    target: "terminal",
  },
])("$name", ({ env, attached, target }) => {
  expect(tmuxClipboardTarget(env, attached)).toBe(target)
})

test.skipIf(process.platform !== "linux" || !Bun.which("tmux"))(
  "a stopped tmux server cannot leave copy pending indefinitely",
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-clipboard-timeout-"))
    const socket = path.join(dir, "tmux.sock")
    const server = Number(
      new TextDecoder()
        .decode(
          Bun.spawnSync([
            "tmux",
            "-S",
            socket,
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-P",
            "-F",
            "#{pid}",
            "sleep 30",
          ]).stdout,
        )
        .trim(),
    )
    expect(server).toBeGreaterThan(0)
    try {
      process.kill(server, "SIGSTOP")
      const clipboard = createTmuxClipboard(
        {
          read: async () => undefined,
          write: async () => "written" as const,
          dispose: async () => {},
        },
        { ...process.env, TMUX: `${socket},${server},0`, TMUX_PANE: "%0" },
      )
      await expect(clipboard.write("stopped server")).rejects.toThrow("tmux clipboard command timed out")
    } finally {
      process.kill(server, "SIGCONT")
      Bun.spawnSync(["tmux", "-S", socket, "kill-server"])
      await rm(dir, { recursive: true, force: true })
    }
  },
  15_000,
)
