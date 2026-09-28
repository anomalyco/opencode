// Phase 5 fix round: a read-only parent can't escalate through a writer child, task ids can't be steered across
// parents, and child denials reach the parent's exit code.
import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import type { SessionRecord } from "../../src/contract"
import { oclite } from "../lib/cli"
import { reply } from "../lib/local-server"
import { setup, taskIds, toolNames } from "./harness"

const PLAN = "---\nmode: primary\nread_only: true\ntools: [task]\n---\nYou are the plan agent (parent)."
const results = (records: readonly SessionRecord[]) => records.flatMap((record) => (record.type === "tool_result" ? [record] : []))
const spawnCode = reply.tool_call({ name: "task", args: { description: "write it", subagent_type: "code", prompt: "change a.txt" } })

async function writerAttempt(env: Awaited<ReturnType<typeof setup>>, agent: string) {
  env.parent.queue(spawnCode)
  env.parent.queue(reply.text("done"))
  env.child.queue([
    reply.tool_call({ name: "edit", args: { filePath: path.join(env.project.path, "a.txt"), oldString: "original", newString: "changed" } }),
    reply.tool_call({ name: "write", args: { filePath: path.join(env.project.path, "new.txt"), content: "x" } }),
    reply.tool_call({ name: "bash", args: { command: "touch pwned.txt" } }),
    reply.tool_call({ name: "bash", args: { command: "git status" } }),
  ])
  env.child.queue(reply.text("could not write"))
  const out = await env.run("go", { agent })
  expect(results(out.records)[0]).toMatchObject({ name: "task", status: "ok" })
  const child = taskIds(results(out.records)[0]!.output)[0]!
  const calls = results(await Effect.runPromise(out.store.read(child))).map((record) => [record.name, record.status] as const)
  expect(calls.slice(0, 3).every((call) => call[1] === "denied" || call[1] === "error")).toBe(true)
  // The child keeps read-only git (its own read_only rules re-apply after the inherited denies).
  expect(calls[3]).toEqual(["bash", "ok"])
  expect(toolNames(env.child.chats()[0]!.body)).not.toContain("edit")
  expect(toolNames(env.child.chats()[0]!.body)).not.toContain("write")
  expect(await env.project.read("a.txt")).toBe("original")
  expect(await Bun.file(path.join(env.project.path, "new.txt")).exists()).toBe(false)
  expect(await Bun.file(path.join(env.project.path, "pwned.txt")).exists()).toBe(false)
}

describe("sub-agent escalation", () => {
  test("a read_only plan primary with task approved can't write through a `code` child", async () => {
    await using env = await setup({ agents: { plan: PLAN }, files: { "a.txt": "original" } })
    await writerAttempt(env, "plan")
  })

  test("--permission-mode plan: the `code` child can't write either", async () => {
    await using env = await setup({ args: { permissionMode: "plan" }, files: { "a.txt": "original" } })
    await writerAttempt(env, "build")
  })

  test("--allowed-tools edit,bash with plan mode still can't write through a child", async () => {
    await using env = await setup({ args: { permissionMode: "plan", allowedTools: ["edit", "bash"] }, files: { "a.txt": "original" } })
    await writerAttempt(env, "build")
  })

  test("a task_id owned by another parent can't be steered", async () => {
    await using env = await setup({ child: { hang: true } })
    env.parent.queue(reply.tool_call({ name: "task", args: { description: "bg", subagent_type: "explore", prompt: "p", background: true } }))
    env.parent.queue(reply.text("waiting"))
    const out = await env.within((runtime, store) =>
      Effect.gen(function* () {
        const owner = yield* runtime.start({ agent: "build", prompt: "own" }, env.sink)
        const child = yield* Effect.gen(function* () {
          while (true) {
            const row = (yield* store.read(owner.session_id)).find((record) => record.type === "subagent" && record.state === "running")
            if (row?.type === "subagent") return row.child_id
            yield* Effect.sleep(20)
          }
        })
        env.parent.queue(reply.tool_call({ name: "task", args: { description: "x", subagent_type: "explore", prompt: "HIJACK", task_id: child } }))
        env.parent.queue(reply.text("tried"))
        const intruder = yield* runtime.start({ agent: "build", prompt: "intrude" }, env.sink)
        yield* intruder.await
        const records = yield* store.read(intruder.session_id)
        yield* owner.cancel
        return { records, child: yield* runtime.subagents.get(child) }
      }),
    )
    expect(results(out.records)[0]).toMatchObject({ name: "task", status: "error" })
    expect(results(out.records)[0]!.output).toContain("is not a sub-agent task of this session")
    expect(out.child?.state).toBe("cancelled")
  })

  test("-p: a child's rejected edit makes the parent exit 3", async () => {
    await using env = await setup({ files: { "a.txt": "original" } })
    env.parent.queue(spawnCode)
    env.parent.queue(reply.text("parent done"))
    env.child.queue(reply.tool_call({ name: "edit", args: { filePath: path.join(env.project.path, "a.txt"), oldString: "original", newString: "changed" } }))
    env.child.queue(reply.text("edit was rejected"))
    const result = await oclite(["-p", "go"], { cwd: env.project.path, home: env.home.path })
    expect(result.stdout).toContain("parent done")
    expect(result.code).toBe(3)
    expect(await env.project.read("a.txt")).toBe("original")
  })
})
