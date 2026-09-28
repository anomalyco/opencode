// Phase 7: a hook that hangs. It is killed at its timeout (10 s by default; a short override here), reported as a
// warning, and the run continues.
import { describe, expect, test } from "bun:test"
import path from "path"
import { setup } from "../cli/harness"
import { reply } from "../lib/local-server"
import { events, groupAlive, patchConfig, spawn, until } from "./lib"

describe("hanging hook", () => {
  test("PreToolUse hook past its timeout: killed with its children, warning shown, tool still runs, exit 0", async () => {
    await using env = await setup({ files: { "a.txt": "alpha" } })
    const pidFile = path.join(env.project.path, "hook.pid")
    await patchConfig(env, {
      hooks: { PreToolUse: [{ matcher: "read", command: `echo $$ > "${pidFile}"; sleep 30`, timeout: 300 }] },
    })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }), reply.text("read it"))
    const started = Date.now()
    const result = await spawn(env, ["-p", "read a.txt", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(result.stdout + result.stderr).toContain("timed out after 0.3 s")
    const stream = events(result.stdout)
    expect(stream.find((event) => event.type === "tool_end")).toMatchObject({ name: "read", status: "ok" })
    expect(JSON.stringify(env.server.chats()[1]?.body?.messages)).toContain("alpha")
    expect(stream.at(-1)).toMatchObject({ type: "result", text: "read it", exit_code: 0 })
    const pid = Number(await Bun.file(pidFile).text())
    expect(await until(() => !groupAlive(pid))).toBe(true)
  }, 30_000)

  test("Stop hook that hangs does not hold the run open", async () => {
    await using env = await setup()
    await patchConfig(env, { hooks: { Stop: [{ command: "sleep 30", timeout: 300 }] } })
    env.server.queue(reply.text("finished"))
    const started = Date.now()
    const result = await spawn(env, ["-p", "hi"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("finished\n")
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 30_000)
})
