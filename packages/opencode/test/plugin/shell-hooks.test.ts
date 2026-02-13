import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { ShellHooksPlugin } from "../../../../.opencode/plugins/shell-hooks"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HooksConfig = {
  hooks?: Record<string, Array<{ command: string; timeout?: number; async?: boolean }>>
}

async function setupPlugin(configOrFn: HooksConfig | ((tmpPath: string) => HooksConfig)) {
  const tmp = await tmpdir()
  const ocDir = path.join(tmp.path, ".opencode")
  await fs.mkdir(ocDir, { recursive: true })
  const config = typeof configOrFn === "function" ? configOrFn(tmp.path) : configOrFn
  await Bun.write(path.join(ocDir, "hooks.json"), JSON.stringify(config))
  const hooks = await ShellHooksPlugin({ directory: tmp.path } as any)
  return {
    hooks,
    tmp,
    [Symbol.asyncDispose]: async () => {
      await tmp[Symbol.asyncDispose]()
    },
  }
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      if (content.length > 0) return content
    } catch {}
    await Bun.sleep(50)
  }
  throw new Error(`waitForFile: ${filePath} not found within ${timeoutMs}ms`)
}

// ---------------------------------------------------------------------------
// PreToolUse
// ---------------------------------------------------------------------------

describe("plugin.shell-hooks", () => {
  describe("PreToolUse", () => {
    test("passthrough (exit 0, no stdout)", async () => {
      await using ctx = await setupPlugin({
        hooks: { PreToolUse: [{ command: "exit 0" }] },
      })

      const out = { args: { foo: "bar" } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ foo: "bar" })
    })

    test("arg modification (JSON stdout)", async () => {
      await using ctx = await setupPlugin({
        hooks: {
          PreToolUse: [{ command: `echo '{"modified":true}'` }],
        },
      })

      const out: { args: Record<string, unknown> } = { args: { original: 1 } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ original: 1, modified: true })
    })

    test("block (exit 2)", async () => {
      await using ctx = await setupPlugin({
        hooks: {
          PreToolUse: [{ command: `echo 'blocked' >&2; exit 2` }],
        },
      })

      const out = { args: {} }
      await expect(
        (ctx.hooks as any)["tool.execute.before"](
          { sessionID: "s1", tool: "dangerous" },
          out,
        ),
      ).rejects.toThrow("PreToolUse hook blocked")
    })

    test("payload via stdin", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          PreToolUse: [
            { command: `cat > "${tmp}/payload.json"` },
          ],
        },
      }))

      const out = { args: { key: "value" } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "sess-42", tool: "read" },
        out,
      )

      const raw = await fs.readFile(
        path.join(ctx.tmp.path, "payload.json"),
        "utf-8",
      )
      const payload = JSON.parse(raw)
      expect(payload.hook_event_name).toBe("PreToolUse")
      expect(payload.session_id).toBe("sess-42")
      expect(payload.tool_name).toBe("read")
      expect(payload.tool_input).toEqual({ key: "value" })
      expect(payload.cwd).toBe(ctx.tmp.path)
    })

    test("non-JSON stdout ignored", async () => {
      await using ctx = await setupPlugin({
        hooks: {
          PreToolUse: [{ command: `echo 'not json'` }],
        },
      })

      const out = { args: { a: 1 } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ a: 1 })
    })

    test("non-zero non-2 exit skipped", async () => {
      await using ctx = await setupPlugin({
        hooks: {
          PreToolUse: [{ command: `exit 1` }],
        },
      })

      const out = { args: { a: 1 } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ a: 1 })
    })
  })

  // -------------------------------------------------------------------------
  // PostToolUse
  // -------------------------------------------------------------------------

  describe("PostToolUse", () => {
    test("payload verification", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          PostToolUse: [
            { command: `cat > "${tmp}/post.json"` },
          ],
        },
      }))

      await (ctx.hooks as any)["tool.execute.after"](
        { sessionID: "s-post", tool: "write" },
        { output: "file written" },
      )

      const raw = await waitForFile(path.join(ctx.tmp.path, "post.json"))
      const payload = JSON.parse(raw)
      expect(payload.tool_name).toBe("write")
      expect(payload.tool_response).toBe("file written")
    })

    test("env variables set", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          PostToolUse: [
            { command: `env > "${tmp}/env.txt"` },
          ],
        },
      }))

      await (ctx.hooks as any)["tool.execute.after"](
        { sessionID: "s-env", tool: "bash" },
        { output: "ok" },
      )

      const envContent = await waitForFile(
        path.join(ctx.tmp.path, "env.txt"),
      )
      expect(envContent).toContain("OPENCODE_SESSION_ID=s-env")
      expect(envContent).toContain(`OPENCODE_PROJECT_DIR=${ctx.tmp.path}`)
      expect(envContent).toContain("OPENCODE_HOOK_EVENT=PostToolUse")
    })
  })

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  describe("Stop", () => {
    test("fires on session.idle", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          Stop: [
            { command: `cat > "${tmp}/stop.json"` },
          ],
        },
      }))

      await (ctx.hooks as any).event({
        event: {
          type: "session.idle",
          properties: { sessionID: "s-stop" },
        },
      })

      const raw = await waitForFile(path.join(ctx.tmp.path, "stop.json"))
      const payload = JSON.parse(raw)
      expect(payload.hook_event_name).toBe("Stop")
      expect(payload.session_id).toBe("s-stop")
    })

    test("ignores unrelated events", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          Stop: [
            { command: `touch "${tmp}/stop-marker"` },
          ],
        },
      }))

      // SessionStart is handled by session.created, not session.idle
      // So Stop hooks should NOT fire
      await (ctx.hooks as any).event({
        event: {
          type: "session.created",
          properties: { sessionID: "s-ignore" },
        },
      })

      await Bun.sleep(200)
      const exists = await fs
        .access(path.join(ctx.tmp.path, "stop-marker"))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Notification
  // -------------------------------------------------------------------------

  describe("Notification", () => {
    test("fires on session.error", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          Notification: [
            { command: `cat > "${tmp}/notif.json"` },
          ],
        },
      }))

      await (ctx.hooks as any).event({
        event: {
          type: "session.error",
          properties: {
            sessionID: "s-notif",
            error: { message: "something broke" },
          },
        },
      })

      const raw = await waitForFile(path.join(ctx.tmp.path, "notif.json"))
      const payload = JSON.parse(raw)
      expect(payload.hook_event_name).toBe("Notification")
      expect(payload.session_id).toBe("s-notif")
      expect(payload.error).toEqual({ message: "something broke" })
    })

    test("missing sessionID defaults to empty string", async () => {
      await using ctx = await setupPlugin((tmp) => ({
        hooks: {
          Notification: [
            { command: `cat > "${tmp}/notif2.json"` },
          ],
        },
      }))

      await (ctx.hooks as any).event({
        event: {
          type: "session.error",
          properties: { error: { message: "no session" } },
        },
      })

      const raw = await waitForFile(path.join(ctx.tmp.path, "notif2.json"))
      const payload = JSON.parse(raw)
      expect(payload.session_id).toBe("")
    })
  })

  // -------------------------------------------------------------------------
  // no config
  // -------------------------------------------------------------------------

  describe("no config", () => {
    test("missing hooks.json is a no-op", async () => {
      await using tmp = await tmpdir()
      const hooks = await ShellHooksPlugin({ directory: tmp.path } as any)

      const out = { args: { unchanged: true } }
      await (hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ unchanged: true })
    })

    test("empty hooks object is a no-op", async () => {
      await using ctx = await setupPlugin({ hooks: {} })

      const out = { args: { unchanged: true } }
      await (ctx.hooks as any)["tool.execute.before"](
        { sessionID: "s1", tool: "bash" },
        out,
      )
      expect(out.args).toEqual({ unchanged: true })
    })
  })
})
