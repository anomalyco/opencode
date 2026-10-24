import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { attachmentThumbnail } from "./thumbnail"
import type { ThumbnailRequest } from "./thumbnail.worker"

const originalImage = globalThis.Image

const originalWorker = globalThis.Worker

let requested = Promise.withResolvers<{ worker: RasterWorker; job: ThumbnailRequest }>()

const workers: RasterWorker[] = []

const releases: (() => void)[] = []

const originals: string[] = []

class RasterWorker {
  onmessage?: (event: { data: { id: number; blob?: Blob } }) => void
  onerror?: () => void
  stopped = false
  constructor() {
    workers.push(this)
  }
  postMessage(job: ThumbnailRequest) {
    requested.resolve({ worker: this, job })
  }
  terminate() {
    this.stopped = true
  }
}

beforeEach(() => {
  requested = Promise.withResolvers()
  workers.length = 0
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: class {
      naturalWidth = 1024
      naturalHeight = 512
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
      removeAttribute() {}
    },
  })
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: RasterWorker })
})

afterEach(() => {
  releases.splice(0).forEach((release) => release())
  originals.splice(0).forEach((url) => URL.revokeObjectURL(url))
  globalThis.Image = originalImage
  globalThis.Worker = originalWorker
  mock.restore()
})

function source(id: string) {
  const url = URL.createObjectURL(new Blob(["original bytes"]))
  originals.push(url)

  return { id, url }
}

function acquire(blob: { id: string; url: string }) {
  const preview = attachmentThumbnail(blob)
  releases.push(preview.release)

  return preview
}

test("shares an in-flight thumbnail and releases only its URL after the last consumer", async () => {
  const blob = source("shared")
  const revoke = spyOn(URL, "revokeObjectURL")
  const first = acquire(blob)
  const second = acquire(blob)
  const { worker, job } = await requested.promise
  expect(first.ready).toBe(second.ready)
  expect(workers).toHaveLength(1)
  worker.onmessage?.({ data: { id: job.id, blob: new Blob(["thumbnail bytes"]) } })
  const url = (await first.ready)!
  expect(worker.stopped).toBe(true)
  first.release()
  first.release()
  expect(revoke).not.toHaveBeenCalled()
  second.release()
  expect(revoke).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledWith(url)
  expect(revoke).not.toHaveBeenCalledWith(blob.url)
})

test("does not retain a late result after removal or interfere with a new consumer of the same image", async () => {
  const blob = source("removed")
  const create = spyOn(URL, "createObjectURL")
  const first = acquire(blob)
  const initial = await requested.promise
  first.release()
  requested = Promise.withResolvers()
  const second = acquire(blob)
  const next = await requested.promise
  initial.worker.onmessage?.({ data: { id: initial.job.id, blob: new Blob(["discarded"]) } })
  expect(await first.ready).toBeUndefined()
  expect(create).not.toHaveBeenCalled()
  expect(next.worker.stopped).toBe(false)
  next.worker.onmessage?.({ data: { id: next.job.id, blob: new Blob(["fresh"]) } })
  expect(await second.ready).toBeDefined()
  expect(create).toHaveBeenCalledTimes(1)
  expect(next.worker.stopped).toBe(true)
})

test("settles a failed worker without retaining it and can retry on the next mount", async () => {
  const blob = source("failed")
  const first = acquire(blob)
  const { worker } = await requested.promise
  worker.onerror?.()
  expect(await first.ready).toBeUndefined()
  expect(worker.stopped).toBe(true)
  first.release()
  requested = Promise.withResolvers()
  const second = acquire(blob)
  const next = await requested.promise
  expect(next.worker).not.toBe(worker)
  next.worker.onmessage?.({ data: { id: next.job.id, blob: new Blob(["recovered"]) } })
  expect(await second.ready).toBeDefined()
})
