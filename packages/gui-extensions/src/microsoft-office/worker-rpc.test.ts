import { afterEach, describe, expect, test } from "bun:test"
import type { FixtureMethods } from "./worker-rpc.fixture"
import { createWorkerClient, SupersededError, WorkerClosedError } from "./worker-rpc"

const clients: ReturnType<typeof createWorkerClient<FixtureMethods>>[] = []

afterEach(() => clients.splice(0).forEach((client) => client.close()))

describe("worker rpc", () => {
  test("a newer call with the same key replaces one still waiting to run", async () => {
    const client = start()
    const busy = client.call("sleep", 50)
    const first = client.call("echo", "first", { key: "echo" })
    const second = client.call("echo", "second", { key: "echo" })

    await expect(first).rejects.toBeInstanceOf(SupersededError)
    expect(await second).toBe("second")
    await busy
    expect((await client.call("log", undefined)).ran).toEqual(["sleep", "echo:second"])
  })

  test("an aborted call rejects at once, and never runs while it waits", async () => {
    const client = start()
    const controller = new AbortController()
    const busy = client.call("sleep", 50)
    const call = client.call("echo", "aborted", { signal: controller.signal })

    controller.abort()
    await expect(call).rejects.toBeInstanceOf(WorkerClosedError)
    await busy
    expect(await client.call("echo", "next")).toBe("next")
    expect((await client.call("log", undefined)).ran).toEqual(["sleep", "echo:next"])
  })

  test("an aborted running call aborts its handler's signal", async () => {
    const client = start()
    const controller = new AbortController()
    const call = client.call("hold", undefined, { signal: controller.signal })

    await Bun.sleep(30)
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(WorkerClosedError)
    expect(await client.call("log", undefined)).toEqual({ ran: ["hold"], aborted: ["hold"], closed: 0 })
  })

  test("a handler that finishes after its call was aborted closes its bitmaps instead of replying", async () => {
    const client = start()
    const controller = new AbortController()
    const call = client.call("paint", 50, { signal: controller.signal })

    await Bun.sleep(20)
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(WorkerClosedError)
    // The stand-in bitmap cannot be posted, so a reply would fail in the worker before it counted a close.
    expect(await client.call("log", undefined)).toEqual({ ran: ["paint"], aborted: [], closed: 1 })
  })

  test("a reply that crosses its call's cancel is dropped", async () => {
    const client = start()
    const controller = new AbortController()
    const call = client.call("spin", 100, { signal: controller.signal })

    await Bun.sleep(30)
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(WorkerClosedError)
    // The worker replied before it read the cancel, and the window's next calls still settle with their own replies.
    expect(await client.call("echo", "after")).toBe("after")
    expect((await client.call("log", undefined)).ran).toEqual(["spin", "echo:after"])
  })

  test("close rejects the pending calls and every later one", async () => {
    const client = start()
    const pending = client.call("sleep", 1000)

    client.close()
    await expect(pending).rejects.toBeInstanceOf(WorkerClosedError)
    await expect(client.call("echo", "late")).rejects.toBeInstanceOf(WorkerClosedError)
  })
})

function start() {
  const client = createWorkerClient<FixtureMethods>(
    new Worker(new URL("./worker-rpc.fixture.ts", import.meta.url), { type: "module" }),
  )

  clients.push(client)

  return client
}
