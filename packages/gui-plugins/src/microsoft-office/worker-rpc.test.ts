import { afterEach, describe, expect, test } from "bun:test"
import type { FixtureMethods } from "./worker-rpc.fixture"
import { AbortedError, createWorkerClient, SupersededError, WorkerClosedError } from "./worker-rpc"

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
    await expect(call).rejects.toBeInstanceOf(AbortedError)
    await busy
    expect(await client.call("echo", "next")).toBe("next")
    expect((await client.call("log", undefined)).ran).toEqual(["sleep", "echo:next"])
  })

  test("an aborted running call aborts its handler's signal", async () => {
    const client = start()
    const controller = new AbortController()
    const running = client.started("hold")
    const call = client.call("hold", undefined, { signal: controller.signal })

    await running
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(AbortedError)
    expect(await client.call("log", undefined)).toEqual({ ran: ["hold"], aborted: ["hold"], closed: 0 })
  })

  test("a handler that finishes after its call was aborted closes its bitmaps instead of replying", async () => {
    const client = start()
    const controller = new AbortController()
    const running = client.started("paint")
    const call = client.call("paint", 200, { signal: controller.signal })

    await running
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(AbortedError)
    // The stand-in bitmap cannot be posted, so a reply would fail in the worker before it counted a close.
    expect(await client.call("log", undefined)).toEqual({ ran: ["paint"], aborted: [], closed: 1 })
  })

  test("a reply that crosses its call's cancel is dropped", async () => {
    const client = start()
    const controller = new AbortController()
    const running = client.started("spin")
    const call = client.call("spin", 100, { signal: controller.signal })

    await running
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(AbortedError)
    // The worker replied before it read the cancel, and the window's next calls still settle with their own replies.
    expect(await client.call("echo", "after")).toBe("after")
    expect((await client.call("log", undefined)).ran).toEqual(["spin", "echo:after"])
  })

  test("a reply that cannot be posted rejects its call, frees its bitmaps, and the next call still runs", async () => {
    const client = start()

    // The stand-in bitmap cannot be posted, as a detached or uncloneable reply cannot.
    await expect(client.call("paint", 0)).rejects.toThrow()
    expect(await client.call("echo", "after")).toBe("after")
    expect(await client.call("log", undefined)).toEqual({ ran: ["paint", "echo:after"], aborted: [], closed: 1 })
  })

  test("close rejects the pending calls and every later one", async () => {
    const client = start()
    const pending = client.call("sleep", 1000)

    client.close()
    await expect(pending).rejects.toBeInstanceOf(WorkerClosedError)
    await expect(client.call("echo", "late")).rejects.toBeInstanceOf(WorkerClosedError)
  })
})

// Each test starts its own worker, so a fixed delay before an abort can land before the worker has loaded and the cancel
// would withdraw a call that never ran. `started` resolves once the fixture reports that the method's handler is running.
function start() {
  const worker = new Worker(new URL("./worker-rpc.fixture.ts", import.meta.url), { type: "module" })
  const client = createWorkerClient<FixtureMethods>(worker)

  clients.push(client)

  return {
    ...client,
    started: (method: keyof FixtureMethods) =>
      new Promise<void>((resolve) =>
        worker.addEventListener("message", (event: MessageEvent<{ readonly started?: string }>) => {
          if (event.data.started === method) resolve()
        }),
      ),
  }
}
