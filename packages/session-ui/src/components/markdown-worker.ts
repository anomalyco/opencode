import {
  applyMarkdownWorkerResponse,
  shouldReleaseMarkdownWorkerState,
  type MarkdownWorkerRequest,
  type MarkdownWorkerResponse,
  type MarkdownWorkerState,
} from "./markdown-worker-protocol"
import { createWorkerTransport } from "./markdown-worker-transport"
import type { Projection } from "./markdown-stream"

type HighlightPending = {
  key: string
  complete: boolean
  resolve: (state: MarkdownWorkerState) => void
  reject: (error: Error) => void
}

type ProjectPending = {
  key: string
  resolve: (projection: Projection) => void
  reject: (error: Error) => void
}

type ParsePending = {
  resolve: (html: string) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let disabled: Error | undefined
let nextID = 0
const pending = new Map<number, HighlightPending>()
const projects = new Map<number, ProjectPending>()
const parses = new Map<number, ParsePending>()
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
const projectTransport = createWorkerTransport<Extract<MarkdownWorkerRequest, { type: "project" }>>({
  post: (request) => worker!.postMessage(request),
  supersede: (request) => {
    const result = projects.get(request.id)
    if (!result) return
    projects.delete(request.id)
    result.reject(new MarkdownWorkerSupersededError())
  },
})

export function parseMarkdown(text: string, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new MarkdownWorkerDisposedError())
  const instance = getWorker()
  const id = ++nextID
  const abort = () => {
    parses.get(id)?.reject(new MarkdownWorkerDisposedError())
    parses.delete(id)
  }
  return new Promise<string>((resolve, reject) => {
    parses.set(id, { resolve, reject })
    signal.addEventListener("abort", abort, { once: true })
    instance.postMessage({ type: "parse", id, text } satisfies MarkdownWorkerRequest)
  }).finally(() => {
    signal.removeEventListener("abort", abort)
    parses.delete(id)
  })
}

export function projectMarkdown(key: string, text: string, live: boolean) {
  getWorker()
  const id = ++nextID
  return new Promise<Projection>((resolve, reject) => {
    projects.set(id, { key, resolve, reject })
    projectTransport.send({ type: "project", id, key, text, live })
  })
}

export function disposeMarkdownProjection(key: string) {
  projectTransport.dispose(key)
  projects.forEach((request, id) => {
    if (request.key !== key) return
    projects.delete(id)
    request.reject(new MarkdownWorkerDisposedError())
  })
  worker?.postMessage({ type: "dispose", key } satisfies MarkdownWorkerRequest)
}

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
    worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" })
  } catch (error) {
    disabled = error instanceof Error ? error : new Error(String(error))
    throw new MarkdownWorkerUnavailableError(disabled.message)
  }
  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    if (event.data.type === "parse") {
      const result = parses.get(event.data.id)
      if (!result) return
      parses.delete(event.data.id)
      result.resolve(event.data.html)
      return
    }
    if (event.data.type === "project") {
      const result = projects.get(event.data.id)
      if (!result) {
        projectTransport.complete(event.data.key, event.data.id)
        return
      }
      projects.delete(event.data.id)
      result.resolve(event.data.projection)
      projectTransport.complete(event.data.key, event.data.id)
      return
    }
    if (event.data.type === "error") {
      const parsed = parses.get(event.data.id)
      if (parsed) {
        parses.delete(event.data.id)
        parsed.reject(new Error(event.data.message))
        return
      }
      const projected = projects.get(event.data.id)
      if (projected) {
        projects.delete(event.data.id)
        projected.reject(new Error(event.data.message))
        projectTransport.complete(projected.key, event.data.id)
        return
      }
    }
    if (event.data.type === "superseded") {
      const projected = projects.get(event.data.id)
      if (projected) {
        projects.delete(event.data.id)
        projected.reject(new MarkdownWorkerSupersededError())
        projectTransport.complete(projected.key, event.data.id)
        return
      }
    }
    const key = event.data.key
    if (!key) return
    const result = pending.get(event.data.id)
    if (!result) {
      transport.complete(key, event.data.id)
      return
    }
    pending.delete(event.data.id)
    if (!keys.has(key)) {
      result.reject(new MarkdownWorkerDisposedError())
      transport.complete(key, event.data.id)
      return
    }
    if (event.data.type === "superseded") {
      result.reject(new MarkdownWorkerSupersededError())
      transport.complete(key, event.data.id)
      return
    }
    if (event.data.type === "error") {
      result.reject(new Error(event.data.message))
      transport.complete(key, event.data.id)
      return
    }
    const state = applyMarkdownWorkerResponse(states.get(key), event.data)
    if (shouldReleaseMarkdownWorkerState(result.complete, latest.get(key), event.data.id)) {
      states.delete(key)
      keys.delete(key)
      latest.delete(key)
    } else states.set(key, state)
    result.resolve(state)
    transport.complete(key, event.data.id)
  }
  const fail = (message: string) => {
    const error = new Error(message)
    disabled = error
    transport.reset()
    projectTransport.reset()
    pending.forEach((request) => request.reject(error))
    projects.forEach((request) => request.reject(error))
    parses.forEach((request) => request.reject(error))
    pending.clear()
    projects.clear()
    parses.clear()
    states.clear()
    keys.clear()
    latest.clear()
    worker?.terminate()
    worker = undefined
  }
  worker.onerror = (event) => fail(event.message || "Markdown highlighting worker failed")
  worker.onmessageerror = () => fail("Markdown worker response failed")
  return worker
}
