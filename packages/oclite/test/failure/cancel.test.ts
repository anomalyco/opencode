// Phase 7: SIGINT while work is in flight: a long bash tool, and background sub-agents running their own tools.
import { describe, expect, test } from "bun:test"
import path from "path"
import { setup } from "../cli/harness"
import { reply, startLocalServer } from "../lib/local-server"
import { alive, events, exportSession, groupAlive, patchConfig, spawn, until } from "./lib"

const taskIds = (text: string) => [...text.matchAll(/<task id="(ses_[A-Za-z0-9]+)"/g)].map((match) => match[1]!)

describe("cancel", () => {
  test("SIGINT during bash sleep 30 → exit 130, the sleep's process group is gone, JSONL ends cancelled", async () => {
    await using env = await setup()
    const pidFile = path.join(env.project.path, "sleep.pid")
    env.server.queue(reply.tool_call({ name: "bash", args: { command: `echo $$ > "${pidFile}"; sleep 30` } }))
    const sent = { done: false }
    const started = Date.now()
    const result = await spawn(env, ["-p", "sleep", "--allowed-tools", "bash", "--output-format", "stream-json"], {
      onLine: (line, proc) => {
        if (sent.done || !line.includes('"type":"tool_start"')) return
        sent.done = true
        void until(() => Bun.file(pidFile).exists()).then(() => proc.kill("SIGINT"))
      },
    })
    expect(result.code).toBe(130)
    expect(Date.now() - started).toBeLessThan(15_000)
    const pid = Number(await Bun.file(pidFile).text())
    expect(pid).toBeGreaterThan(0)
    expect(await until(() => !groupAlive(pid))).toBe(true)
    const last = events(result.stdout).at(-1)
    expect(last).toMatchObject({ type: "result", state: "cancelled", exit_code: 130 })
    const records = await exportSession(env, String(last?.session_id))
    expect(records.at(-1)).toMatchObject({ type: "end", reason: "cancelled" })
  }, 30_000)

  test("SIGINT with two background sub-agents in bash: no orphan processes, every child's JSONL ends cancelled", async () => {
    await using env = await setup()
    // Children get their own fake so their scripted replies never interleave with the parent's.
    await using kid = await startLocalServer()
    const config = JSON.parse(await env.project.read(".oclite/config.json"))
    await patchConfig(env, {
      provider: { ...config.provider, kid: { npm: "@ai-sdk/openai-compatible", options: { baseURL: kid.url }, models: { m: {} } } },
      servers: { ...config.servers, [kid.url]: config.servers[env.server.url] },
      agent: { code: { model: "kid/m" } },
      permission: { task: "allow", bash: "allow" },
    })
    const pids = path.join(env.project.path, "pids.txt")
    const task = (description: string) =>
      reply.tool_call({ name: "task", args: { description, subagent_type: "code", prompt: "run the sleep", background: true } })
    env.server.queue([task("one"), task("two")], reply.text("waiting for both"))
    kid.queue(
      reply.tool_call({ name: "bash", args: { command: `echo $$ >> "${pids}"; sleep 30` } }),
      reply.tool_call({ name: "bash", args: { command: `echo $$ >> "${pids}"; sleep 30` } }),
    )
    const sent = { done: false }
    const started = Date.now()
    const result = await spawn(env, ["-p", "fan out", "--profile", "default", "--output-format", "stream-json"], {
      onLine: (line, proc) => {
        if (sent.done || !line.includes('"type":"tool_start"') || !line.includes('"name":"bash"')) return
        sent.done = true
        const both = async () => (await Bun.file(pids).exists()) && (await Bun.file(pids).text()).trim().split("\n").length === 2
        void until(both, 5000).then(() => proc.kill("SIGINT"))
      },
    })
    expect(result.code).toBe(130)
    expect(Date.now() - started).toBeLessThan(20_000)
    const shells = (await Bun.file(pids).text()).trim().split("\n").map(Number)
    expect(shells).toHaveLength(2)
    expect(await until(() => shells.every((pid) => !groupAlive(pid) && !alive(pid)))).toBe(true)

    const last = events(result.stdout).at(-1)
    expect(last).toMatchObject({ type: "result", state: "cancelled", exit_code: 130 })
    const parent = await exportSession(env, String(last?.session_id))
    expect(parent.at(-1)).toMatchObject({ type: "end", reason: "cancelled" })
    const children = parent.flatMap((record) => (record.type === "tool_result" ? taskIds(String(record.output)) : []))
    expect(children).toHaveLength(2)
    for (const child of children) expect((await exportSession(env, child)).at(-1)).toMatchObject({ type: "end", reason: "cancelled" })
    const rows = parent.filter((record) => record.type === "subagent")
    expect(children.map((id) => rows.findLast((row) => row.child_id === id)?.state)).toEqual(["cancelled", "cancelled"])
  }, 40_000)
})
