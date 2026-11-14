import { checksum } from "@opencode/util/encode"
import { parseSmallMarkdown } from "@opencode/ui/context/marked-base"
import DOMPurify from "dompurify"
import {
  INITIAL_MARKDOWN_CACHE_STATE,
  transitionMarkdownCache,
  type MarkdownCacheEffect,
  type MarkdownCacheEntry,
  type MarkdownCacheEvent,
} from "./markdown-cache-machine"
import { abortParseMarkdown, markdownWorkerDisposed, startParseMarkdown } from "./markdown-worker"
import { localImagePath, localLinkPath } from "./markdown-image"

export type { MarkdownCacheEntry } from "./markdown-cache-machine"

const max = 200

// Completed entries in LRU order, oldest first.
const cache = new Map<string, MarkdownCacheEntry>()

let state = INITIAL_MARKDOWN_CACHE_STATE

const queue: MarkdownCacheEvent[] = []

// Consumer ids travel in `render.requested`, so a request queued behind another still settles its own waiter.
let consumers = 0

const waiters = new Map<
  number,
  {
    resolve: (entry: MarkdownCacheEntry) => void
    reject: (error: Error) => void
    signal: AbortSignal | undefined
    cancel: () => void
  }
>()

// The worker request id of each running job, so an abandoned parse can be cancelled.
const workerIds = new Map<number, number>()

// A private instance keeps this hook set separate from other DOMPurify users.
const purifier = typeof window !== "undefined" ? DOMPurify(window) : DOMPurify

if (typeof window !== "undefined" && purifier.isSupported) {
  // A config passed to sanitize() rebuilds every allow-list on each call; set once, every call reuses them.
  purifier.setConfig({
    USE_PROFILES: { html: true, mathMl: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style"],
    FORBID_CONTENTS: ["style", "script"],
    ADD_TAGS: ["svg", "path"],
    ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
  })
  purifier.addHook("beforeSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement) {
      // Local file links never navigate the document; the host decides how to open them.
      node.removeAttribute("data-local-link")
      const path = localLinkPath(node.getAttribute("href") ?? "")

      if (!path) return
      node.setAttribute("data-local-link", path)
      node.setAttribute("role", "link")
      node.setAttribute("tabindex", "0")
      node.removeAttribute("href")
      node.removeAttribute("target")

      return
    }

    if (!(node instanceof HTMLImageElement)) return
    // Local paths are not browser URLs. Keep them inert until the host reads them.
    node.removeAttribute("data-local-image")
    const path = localImagePath(node.getAttribute("src") ?? "")

    if (!path) return
    node.setAttribute("data-local-image", path)
    node.removeAttribute("src")
    node.removeAttribute("srcset")
  })
  purifier.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return

    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!purifier.isSupported) return ""

  return purifier.sanitize(html)
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  remember(key, value)
  dispatch({ type: "cache.touched", key, src: value.src ?? value.raw })
}

export async function preloadMarkdown(text: string, cacheKey: string, signal?: AbortSignal) {
  if (signal?.aborted) throw markdownWorkerDisposed
  const block = { raw: text, src: text }
  const key = `${cacheKey}:0:full`

  if (getReadyMarkdown(block, key)) return
  await renderCachedMarkdown(block, key, signal)
}

export function getReadyMarkdown(block: { raw: string; src: string }, key?: string) {
  const cached = key ? getCachedMarkdown(key) : undefined

  if (key && cached && (cached.src ?? cached.raw) === block.src) {
    touchCachedMarkdown(key, cached)

    return cached
  }

  if (!purifier.isSupported) return

  try {
    const html = parseSmallMarkdown(block.src)

    if (html === undefined) return
    const hash = checksum(block.src)
    const result = { raw: block.raw, src: block.src, hash: hash ?? "", html: sanitizeMarkdown(html) }

    if (key && hash) touchCachedMarkdown(key, result)

    return result
  } catch {
    // Keep parser failures on the normal worker/escaped-text fallback path.
    return
  }
}

/** Joins a running parse of the same key and source; a hit costs no new promise beyond `Promise.resolve`. */
export function renderCachedMarkdown(
  block: { raw: string; src: string },
  key?: string,
  signal?: AbortSignal,
): Promise<MarkdownCacheEntry> {
  if (signal?.aborted) return Promise.reject(markdownWorkerDisposed)

  if (!key) return renderUnkeyed(block, signal)
  const cached = getCachedMarkdown(key)

  if (cached && (cached.src ?? cached.raw) === block.src) {
    touchCachedMarkdown(key, cached)

    return Promise.resolve(cached)
  }

  return new Promise<MarkdownCacheEntry>((resolve, reject) => {
    const consumerId = ++consumers
    const cancel = () => dispatch({ type: "consumer.aborted", consumerId })
    signal?.addEventListener("abort", cancel, { once: true })
    waiters.set(consumerId, { resolve, reject, signal, cancel })
    dispatch({ type: "render.requested", consumerId, key, raw: block.raw, src: block.src })
  })
}

function renderUnkeyed(block: { raw: string; src: string }, signal: AbortSignal | undefined) {
  return new Promise<MarkdownCacheEntry>((resolve, reject) => {
    const cancel = () => abortParseMarkdown(id)
    signal?.addEventListener("abort", cancel, { once: true })

    const id = startParseMarkdown(block.src, {
      resolve: (html) => {
        signal?.removeEventListener("abort", cancel)
        const event = parsed(0, block.raw, block.src, html)

        if (event.type === "parse.succeeded") return resolve(event.entry)
        reject(event.error)
      },
      reject: (error) => {
        signal?.removeEventListener("abort", cancel)
        reject(error)
      },
    })
  })
}

function dispatch(event: MarkdownCacheEvent) {
  queue.push(event)

  // A worker that rejects at once settles a parse while its start effect runs; the outer loop drains it next.
  if (queue.length > 1) return

  while (queue.length > 0) {
    try {
      const next = transitionMarkdownCache(state, queue[0]!)
      state = next.state
      next.effects.forEach(run)
    } catch (error) {
      console.error("Markdown cache transition failed", error)
    } finally {
      queue.shift()
    }
  }
}

function run(effect: MarkdownCacheEffect) {
  try {
    perform(effect)
  } catch (error) {
    console.error("Markdown cache effect failed", error)
  }
}

function perform(effect: MarkdownCacheEffect) {
  if (effect.type === "start-parse") {
    let settled = false

    const id = startParseMarkdown(effect.src, {
      resolve: (html) => {
        settled = true
        workerIds.delete(effect.jobId)
        dispatch(parsed(effect.jobId, effect.raw, effect.src, html))
      },
      reject: (error) => {
        settled = true
        workerIds.delete(effect.jobId)
        dispatch({ type: "parse.failed", jobId: effect.jobId, error })
      },
    })

    if (!settled) workerIds.set(effect.jobId, id)

    return
  }

  if (effect.type === "abort-parse") {
    const id = workerIds.get(effect.jobId)
    workerIds.delete(effect.jobId)

    if (id !== undefined) abortParseMarkdown(id)

    return
  }

  if (effect.type === "store") return remember(effect.key, effect.entry)

  const error =
    effect.type === "reject-consumers" && effect.reason.kind === "error" ? effect.reason.error : markdownWorkerDisposed

  effect.consumerIds.forEach((id) => {
    const waiter = waiters.get(id)

    if (!waiter) return
    waiters.delete(id)
    waiter.signal?.removeEventListener("abort", waiter.cancel)

    if (effect.type === "resolve-consumers") return waiter.resolve(effect.entry)
    waiter.reject(error)
  })
}

// Sanitizing runs inside the worker's settle callback, where a throw would leave every consumer waiting.
function parsed(
  jobId: number,
  raw: string,
  src: string,
  html: string,
): Extract<MarkdownCacheEvent, { type: "parse.succeeded" | "parse.failed" }> {
  try {
    const hash = checksum(src)

    return { type: "parse.succeeded", jobId, entry: { raw, src, hash: hash ?? "", html: sanitizeMarkdown(html) } }
  } catch (error) {
    return { type: "parse.failed", jobId, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

function remember(key: string, value: MarkdownCacheEntry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value

  if (first === undefined) return
  cache.delete(first)
}
