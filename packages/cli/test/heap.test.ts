import { Global } from "@opencode-ai/util/global"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { Heap } from "../src/heap"
import { tmpdir } from "./fixture/tmpdir"

test("scopes the Unix heap signal listener and leaves Windows signals unsupported", async () => {
  const listeners = process.listenerCount("SIGUSR1")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Heap.listen
        expect(process.listenerCount("SIGUSR1")).toBe(listeners + (process.platform === "win32" ? 0 : 1))
      }),
    ).pipe(Effect.provideService(Global.Service, Global.make())),
  )
  expect(process.listenerCount("SIGUSR1")).toBe(listeners)
})

test.skipIf(process.platform === "win32")(
  "writes snapshots from SIGUSR1 and releases the listener",
  async () => {
    await using directory = await tmpdir()
    await using child = start(directory.path)
    await child.wait("ready")

    await child.write("ping")
    await child.wait("pong")
    process.kill(child.pid, "SIGUSR1")
    await child.wait("heap snapshot written")

    const first = (await readdir(directory.path)).filter((name) => name.endsWith(".heapsnapshot"))
    expect(first).toHaveLength(1)
    expect(first[0]).toStartWith(`heap-${child.pid}-`)
    const snapshot = await Bun.file(path.join(directory.path, first[0])).json()
    expect(snapshot.snapshot.node_count).toBeGreaterThan(0)
    expect(snapshot.snapshot.edge_count).toBeGreaterThan(0)
    expect(snapshot.snapshot.meta.node_fields).toContain("self_size")

    process.kill(child.pid, "SIGUSR1")
    await child.wait("heap snapshot written", 2)
    expect((await readdir(directory.path)).filter((name) => name.endsWith(".heapsnapshot"))).toHaveLength(2)

    await child.write("close")
    await child.wait("closed:0")
    await child.write("ping")
    await child.wait("pong", 2)
    await child.write("exit")
    expect(await child.exited).toBe(0)
  },
  30_000,
)

test.skipIf(process.platform === "win32")(
  "continues accepting SIGUSR1 after a snapshot write fails",
  async () => {
    await using directory = await tmpdir()
    const log = path.join(directory.path, "missing")
    await using child = start(log)
    await child.wait("ready")

    process.kill(child.pid, "SIGUSR1")
    await child.wait("failed to write heap snapshot")
    await mkdir(log)
    process.kill(child.pid, "SIGUSR1")
    await child.wait("heap snapshot written")
    expect((await readdir(log)).filter((name) => name.endsWith(".heapsnapshot"))).toHaveLength(1)

    await child.write("exit")
    expect(await child.exited).toBe(0)
  },
  30_000,
)

function start(log: string) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/heap.ts"), log], {
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = { text: "" }
  const stdout = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) output.text += decoder.decode(chunk, { stream: true })
  })()
  const stderr = new Response(child.stderr).text()
  return {
    pid: child.pid,
    exited: child.exited,
    async write(line: string) {
      await child.stdin.write(`${line}\n`)
      await child.stdin.flush()
    },
    async wait(text: string, count = 1) {
      const deadline = Date.now() + 15_000
      while (output.text.split(text).length - 1 < count) {
        if (child.exitCode !== null) throw new Error(`Fixture exited: ${output.text}\n${await stderr}`)
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${text}: ${output.text}`)
        await Bun.sleep(20)
      }
    },
    async [Symbol.asyncDispose]() {
      if (child.exitCode === null) child.kill()
      await Promise.all([child.exited, stdout, stderr])
    },
  }
}
