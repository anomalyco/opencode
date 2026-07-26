import MarkdownShikiWorkerUrl from "./markdown-shiki.worker.ts?worker&url"
import { OpenCodeTheme } from "@opencode-ai/ui/context/marked"
import {
  applyMarkdownWorkerResponse,
  shouldReleaseMarkdownWorkerState,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
  type MarkdownWorkerState,
} from "./markdown-worker-protocol"
import { createWorkerTransport } from "./markdown-worker-transport"

type Pending = {
  key: string
  complete: boolean
  resolve: (state: MarkdownWorkerState) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let disabled: Error | undefined
let nextID = 0
const pending = new Map<number, Pending>()
const states = new Map<string, MarkdownWorkerState>()
const keys = new Set<string>()
const latest = new Map<string, number>()
const transport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "highlight" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => {
    const result = pending.get(request.id)
    if (!result) return
    pending.delete(request.id)
    result.reject(new MarkdownWorkerSupersededError())
  },
})

export function highlightStreamingCode(key: string, text: string, language: string, complete = false) {
  const instance = getWorker()
  const id = ++nextID
  latest.set(key, id)
  keys.delete(key)
  keys.add(key)
  if (keys.size > 200) disposeStreamingCode(keys.values().next().value!)
  return new Promise<MarkdownWorkerState>((resolve, reject) => {
    pending.set(id, { key, complete, resolve, reject })
    transport.send({ type: "highlight", id, key, text, language, complete })
  })
}

export function disposeStreamingCode(key: string) {
  keys.delete(key)
  latest.delete(key)
  states.delete(key)
  transport.dispose(key)
  pending.forEach((request, id) => {
    if (request.key !== key) return
    pending.delete(id)
    request.reject(new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

export class MarkdownWorkerDisposedError extends Error {}
export class MarkdownWorkerSupersededError extends Error {}
export class MarkdownWorkerUnavailableError extends Error {}

function getWorker() {
  if (worker) return worker
  if (disabled) throw new MarkdownWorkerUnavailableError(disabled.message)
  try {
    worker = new Worker(MarkdownShikiWorkerUrl, { type: "module" })
  } catch (error) {
    disabled = error instanceof Error ? error : new Error(String(error))
    throw new MarkdownWorkerUnavailableError(disabled.message)
  }
  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    const result = pending.get(event.data.id)
    if (!result) {
      transport.complete(event.data.key, event.data.id)
      return
    }
    pending.delete(event.data.id)
    if (!keys.has(event.data.key)) {
      result.reject(new MarkdownWorkerDisposedError())
      transport.complete(event.data.key, event.data.id)
      return
    }
    if (event.data.type === "superseded") {
      result.reject(new MarkdownWorkerSupersededError())
      transport.complete(event.data.key, event.data.id)
      return
    }
    if (event.data.type === "error") {
      result.reject(new Error(event.data.message))
      transport.complete(event.data.key, event.data.id)
      return
    }
    const state = applyMarkdownWorkerResponse(states.get(event.data.key), event.data)
    if (shouldReleaseMarkdownWorkerState(result.complete, latest.get(event.data.key), event.data.id)) {
      states.delete(event.data.key)
      keys.delete(event.data.key)
      latest.delete(event.data.key)
    } else states.set(event.data.key, state)
    result.resolve(state)
    transport.complete(event.data.key, event.data.id)
  }
  const fail = (message: string) => {
    const error = new Error(message)
    disabled = error
    transport.reset()
    pending.forEach((request) => request.reject(error))
    pending.clear()
    states.clear()
    keys.clear()
    latest.clear()
    worker?.terminate()
    worker = undefined
  }
  worker.onerror = (event) => fail(event.message || "Markdown highlighting worker failed")
  worker.onmessageerror = () => fail("Markdown worker response failed")
  worker.postMessage({ type: "init", theme: OpenCodeTheme } satisfies MarkdownWorkerRequest)
  return worker
}
