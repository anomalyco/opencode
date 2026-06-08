import { expect, test } from "bun:test"
import { DiffPreparation } from "./client-core"
import { prepareDiff } from "./worker"
import type { DiffWorkerRequest, DiffWorkerResponse } from "./protocol"

class FakeWorker {
  requests: DiffWorkerRequest[] = []
  private listener?: (event: MessageEvent<DiffWorkerResponse>) => void
  private error?: (event: Event) => void

  addEventListener(type: "message", listener: (event: MessageEvent<DiffWorkerResponse>) => void): void
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<DiffWorkerResponse>) => void) | ((event: Event) => void),
  ) {
    if (type === "message") this.listener = listener as (event: MessageEvent<DiffWorkerResponse>) => void
    if (type === "error") this.error = listener as (event: Event) => void
  }

  postMessage(request: DiffWorkerRequest) {
    this.requests.push(request)
    queueMicrotask(() =>
      this.listener?.({ data: { id: request.id, result: prepareDiff(request.source) } } as MessageEvent),
    )
  }

  fail() {
    this.error?.(new Event("error"))
  }
}

test("deduplicates equivalent in-flight and cached preparations", async () => {
  const worker = new FakeWorker()
  const client = new DiffPreparation(worker)
  const source = { file: "a.ts", before: "old\n", after: "new\n" }

  const [first, second] = await Promise.all([client.prepare(source), client.prepare({ ...source })])
  const third = await client.prepare(source)

  expect(worker.requests).toHaveLength(1)
  expect(second).toBe(first)
  expect(third).toBe(first)
  expect(structuredClone(first)).toEqual(first)
})

test("snapshots proxy inputs before posting them to the worker", async () => {
  const worker = new FakeWorker()
  const client = new DiffPreparation(worker)
  const value = { file: "a.ts", before: "old\n", after: "new\n" }
  const source = new Proxy(value, {})

  await client.prepare(source)
  value.after = "newer\n"
  await client.prepare(source)

  expect(worker.requests[0]?.source).toEqual({
    file: "a.ts",
    patch: undefined,
    before: "old\n",
    after: "new\n",
  })
  expect(worker.requests[0]?.source).not.toBe(source)
  expect(worker.requests[1]?.source.after).toBe("newer\n")
})

test("rejects pending requests when the worker fails", async () => {
  const worker = new FakeWorker()
  worker.postMessage = (request) => worker.requests.push(request)
  let failed = 0
  const client = new DiffPreparation(worker, () => failed++)
  const pending = client.prepare({ file: "a.ts", before: "old", after: "new" })

  worker.fail()

  await expect(pending).rejects.toThrow("diff preparation worker failed")
  expect(failed).toBe(1)
})
