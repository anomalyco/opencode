import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import {
  createMarkdownWorkerClient,
  MarkdownWorkerDisposedError,
  MarkdownWorkerUnavailableError,
  type MarkdownWorkerPort,
} from "./markdown-worker"
import { WORKER_BOOT_TIMEOUT_MS, WORKER_HANG_TIMEOUT_MS, WORKER_RETRY_DELAY_MS } from "./markdown-worker-machine"
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from "./markdown-worker-protocol"

class FakeWorker implements MarkdownWorkerPort {
  onmessage: ((event: MessageEvent<MarkdownWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  readonly posted: MarkdownWorkerRequest[] = []
  terminated = false

  postMessage(message: MarkdownWorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  reply(response: MarkdownWorkerResponse) {
    this.onmessage?.(new MessageEvent("message", { data: response }))
  }

  crash(message: string) {
    this.onerror?.(new ErrorEvent("error", { message }))
  }
}

beforeEach(() => jest.useFakeTimers())

afterEach(() => jest.useRealTimers())

function start(spawn?: () => FakeWorker) {
  const workers: FakeWorker[] = []

  const client = createMarkdownWorkerClient(() => {
    const worker = spawn?.() ?? new FakeWorker()
    workers.push(worker)

    return worker
  })

  return { client, workers }
}

const highlight = (id: number, key: string): MarkdownWorkerResponse => ({
  type: "highlight",
  id,
  key,
  language: "ts",
  reset: true,
  stable: [],
  unstable: [["const x", ""]],
})

test("a crashed worker rejects its requests, cools down, then a new worker serves requests", async () => {
  const { client, workers } = start()
  const pending = client.highlightStreamingCode("code", "const x", "ts")
  const first = workers[0]!
  const onmessage = first.onmessage

  first.crash("boom")
  await expect(pending).rejects.toThrow("boom")
  expect(first.terminated).toBe(true)
  expect(first.onmessage).toBeNull()

  await expect(client.highlightStreamingCode("code", "const x", "ts")).rejects.toBeInstanceOf(
    MarkdownWorkerUnavailableError,
  )
  expect(workers).toHaveLength(1)

  // A reply the dead worker had already queued reaches nothing.
  onmessage?.(new MessageEvent("message", { data: highlight(1, "code") }))

  jest.advanceTimersByTime(WORKER_RETRY_DELAY_MS)
  const retried = client.highlightStreamingCode("code", "const x", "ts")
  expect(workers).toHaveLength(2)
  workers[1]!.reply(highlight(3, "code"))
  expect((await retried).unstable).toEqual([["const x", ""]])
})

test("a worker that cannot be constructed rejects as unavailable and is retried after the cooldown", async () => {
  const spawn = jest.fn((): FakeWorker => {
    throw new Error("blocked")
  })

  const { client } = start(spawn)

  await expect(client.projectMarkdown("p", "text", true)).rejects.toBeInstanceOf(MarkdownWorkerUnavailableError)
  await expect(client.projectMarkdown("p", "text", true)).rejects.toBeInstanceOf(MarkdownWorkerUnavailableError)
  expect(spawn).toHaveBeenCalledTimes(1)

  jest.advanceTimersByTime(WORKER_RETRY_DELAY_MS)
  spawn.mockImplementation(() => new FakeWorker())
  void client.projectMarkdown("p", "text", true)
  expect(spawn).toHaveBeenCalledTimes(2)
})

test("a slow cold start is not a hang, and a later stall fails after the hang window", async () => {
  const { client, workers } = start()
  const first = client.parseMarkdown("# hi", new AbortController().signal)

  jest.advanceTimersByTime(WORKER_HANG_TIMEOUT_MS * 2)
  expect(workers[0]!.terminated).toBe(false)
  workers[0]!.reply({ type: "parse", id: 1, html: "<h1>hi</h1>" })
  expect(await first).toBe("<h1>hi</h1>")

  const stalled = client.parseMarkdown("text", new AbortController().signal)
  // The boot window's timer is still pending; it re-arms with the hang window, which then runs out.
  jest.advanceTimersByTime(WORKER_BOOT_TIMEOUT_MS)
  jest.advanceTimersByTime(WORKER_HANG_TIMEOUT_MS)
  await expect(stalled).rejects.toThrow("Markdown worker timed out")
  expect(workers[0]!.terminated).toBe(true)
})

test("a worker that never replies fails when the boot window ends", async () => {
  const { client, workers } = start()
  const pending = client.parseMarkdown("# hi", new AbortController().signal)

  jest.advanceTimersByTime(WORKER_BOOT_TIMEOUT_MS)
  await expect(pending).rejects.toThrow("Markdown worker timed out")
  expect(workers[0]!.terminated).toBe(true)
})

test("an aborted parse rejects as disposed and drops the worker's later reply", async () => {
  const { client, workers } = start()
  const controller = new AbortController()
  const pending = client.parseMarkdown("# hi", controller.signal)

  controller.abort()
  await expect(pending).rejects.toBeInstanceOf(MarkdownWorkerDisposedError)
  workers[0]!.reply({ type: "parse", id: 1, html: "<h1>hi</h1>" })

  const next = client.parseMarkdown("text", new AbortController().signal)
  workers[0]!.reply({ type: "parse", id: 2, html: "<p>text</p>" })
  expect(await next).toBe("<p>text</p>")
})

test("an effect that throws does not stall later requests", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {})

  const { client, workers } = start(() => {
    const worker = new FakeWorker()
    worker.postMessage = (message) => {
      if (message.type === "highlight" && message.key === "a") throw new Error("could not clone")
      worker.posted.push(message)
    }

    return worker
  })

  void client.highlightStreamingCode("a", "x", "ts")
  const second = client.highlightStreamingCode("b", "y", "ts")

  workers[0]!.reply(highlight(2, "b"))
  expect((await second).unstable).toEqual([["const x", ""]])
  error.mockRestore()
})
