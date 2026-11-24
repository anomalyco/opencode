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
import type { MarkdownHTML } from "./markdown-worker-protocol"

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

const rendered = typeof window !== "undefined" ? DOMPurify(window) : DOMPurify

// Sanitized renderer output by its source HTML, most recently used last.
const renderedFragments = new Map<string, Node>()

if (typeof window !== "undefined" && purifier.isSupported) {
  const appLinks = new WeakMap<HTMLAnchorElement, string>()
  const files = new WeakMap<HTMLAnchorElement, string>()
  const images = new WeakMap<HTMLImageElement, string>()

  const prose = new Set(
    "a abbr b bdi bdo blockquote br caption center cite code col colgroup data dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(
      " ",
    ),
  )

  // The rest of what the chat rendered before this allow-list: legacy, sectioning and media markup. Outside `prose`,
  // each is marked for paint containment, so none can lay itself out over the app.
  const contained = "acronym address article aside audio big blink dir font footer header hgroup main marquee menu nav nobr picture search section source spacer strike track tt video".split(" ")

  const paint = [
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
  ]

  const style = document.createElement("span").style
  const allowedStyle = document.createElement("span").style

  // A config passed to sanitize() rebuilds every allow-list on each call; set once, every call reuses them.
  const config = {
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style", "dialog"],
    FORBID_ATTR: [
      "popover",
      "popovertarget",
      "popovertargetaction",
      "command",
      "commandfor",
      "data-floating-overlay",
      "data-markdown-renderer",
    ],
    FORBID_CONTENTS: ["style", "script"],
    ADD_TAGS: ["svg", "path"],
    ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
  }

  purifier.setConfig({
    ...config,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
    ADD_ATTR: [...config.ADD_ATTR, "aria-label", "aria-hidden"],
    ALLOWED_TAGS: [
      ...prose,
      ...contained,
      ..."math mrow mi mn mo ms mtext mspace mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mmultiscripts mprescripts none menclose merror mfenced mpadded mphantom mstyle semantics annotation".split(
        " ",
      ),
    ],
  })
  // These fragments still pass DOMPurify's structural/URI checks, but their renderer owns their inline geometry.
  rendered.setConfig({ ...config, USE_PROFILES: { html: true, mathMl: true }, RETURN_DOM_FRAGMENT: true })
  purifier.addHook("uponSanitizeElement", (node) => {
    // `a`, `use`, `image` and `foreignObject` inside SVG would link, reference or embed; drop them with their contents.
    if (node instanceof SVGElement && node.localName !== "svg" && node.localName !== "path") node.remove()
  })
  purifier.addHook("uponSanitizeAttribute", (node, attr) => {
    // Never import identifiers from the app's styling, focus, shortcut, form or plugin protocols. This allowlist
    // is for document content only. DOMPurify still validates every value and namespaces id and name.
    const tag = node.localName
    const name = attr.attrName

    if (node instanceof SVGElement && paint.includes(name)) {
      attr.keepAttr = svgPaint(name, attr.attrValue)

      return
    }

    const allowed =
      /^(style|id|dir|lang|title|align)$/.test(name) ||
      ((tag === "a" || tag === "img") && name === "aria-label") ||
      (tag === "a" &&
        (name === "href" ||
          name === "download" ||
          name === "name" ||
          name === "rel" ||
          (name === "target" && attr.attrValue === "_blank"))) ||
      (tag === "img" && /^(src|alt|height|width)$/.test(name)) ||
      (/^(q|blockquote|ins|del)$/.test(tag) && name === "cite") ||
      (/^(time|ins|del)$/.test(tag) && name === "datetime") ||
      (tag === "data" && name === "value") ||
      (tag === "font" && /^(color|face|size)$/.test(name)) ||
      (/^(video|audio)$/.test(tag) && /^(src|controls|loop|muted|preload|autoplay)$/.test(name)) ||
      (tag === "video" && /^(poster|playsinline|width|height)$/.test(name)) ||
      (tag === "source" && /^(src|type|srcset|sizes|media)$/.test(name)) ||
      (tag === "track" && /^(src|kind|srclang|label|default)$/.test(name)) ||
      (/^(table|col|th|td)$/.test(tag) && /^(width|colspan|rowspan|scope)$/.test(name)) ||
      (tag === "ol" && /^(start|reversed|type)$/.test(name)) ||
      (tag === "li" && name === "value") ||
      (tag === "details" && name === "open") ||
      (tag === "svg" && /^(viewbox|preserveaspectratio|xmlns|width|height)$/.test(name)) ||
      (tag === "svg" && name === "aria-hidden" && /^(true|false)$/.test(attr.attrValue)) ||
      (tag === "path" && name === "d")

    if (!allowed) {
      attr.keepAttr = false

      return
    }

    const sized = /^(?:img|table|th|td|col|svg|video)$/.test(tag)

    if ((name === "width" || (tag === "svg" && name === "height")) && sized) {
      const width = contentWidth(attr.attrValue, true)
      attr.keepAttr = !!width
      attr.attrValue = width

      return
    }

    if (attr.attrName !== "style") return
    style.cssText = attr.attrValue
    allowedStyle.cssText = ""

    for (const property of [
      "color",
      "background-color",
      "font-weight",
      "font-style",
      "text-decoration-line",
      "text-align",
    ]) {
      allowedStyle.setProperty(property, style.getPropertyValue(property))
    }

    if (sized) allowedStyle.width = contentWidth(style.width, false)

    attr.attrValue = allowedStyle.cssText
    attr.keepAttr = !!attr.attrValue
  })
  purifier.addHook("beforeSanitizeAttributes", (node) => {
    // Removing `is` does not clear Chromium's internal customized-built-in name; serialization can put it back.
    if (node instanceof Element && node.hasAttribute("is"))
      return node.replaceWith(node.ownerDocument.createTextNode(node.textContent ?? ""))

    if (node instanceof HTMLAnchorElement) {
      // Local file links never navigate the document; the host decides how to open them.
      const href = node.getAttribute("href") ?? ""
      const path = localLinkPath(href)

      const protocol = URL.parse(href)?.protocol

      if (protocol && !path && !/^(https?|file):$/.test(protocol)) {
        // Chromium navigates a `download` link it cannot fetch. Only web and file links download; another app's
        // address takes the review like every other.
        node.removeAttribute("download")

        if (href.length > 2048 || /[<>\x00-\x1f\x7f-\x9f]/.test(href)) return node.removeAttribute("href")
        node.removeAttribute("style")
        node.removeAttribute("class")

        // A card, an entire paragraph or a display formula (its slot is still empty here, so the worker marks it) is
        // not a link label. Keep its contents, but don't arm that hit area.
        if (node.querySelector(":not(b,i,em,strong,s,span,code), [data-display]")) return node.removeAttribute("href")

        appLinks.set(node, href)
      }

      if (!path) return
      files.set(node, path)
      node.removeAttribute("href")
      node.removeAttribute("target")

      return
    }

    if (!(node instanceof HTMLImageElement)) return
    // Local paths are not browser URLs. Keep them inert until the host reads them.
    const path = localImagePath(node.getAttribute("src") ?? "")

    if (!path) return
    images.set(node, path)
    node.removeAttribute("src")
    node.removeAttribute("srcset")
  })
  purifier.addHook("afterSanitizeAttributes", (node: Element) => {
    // This application-owned marker only adds containment. Renderer fragments never pass through this hook.
    if (
      node instanceof Element &&
      node.localName !== "body" &&
      (!prose.has(node.localName) || node.hasAttribute("id") || node.hasAttribute("name"))
    )
      node.setAttribute("data-markdown-contain", "")

    if (node instanceof HTMLImageElement) {
      const path = images.get(node)

      if (path) node.dataset.localImage = path
    }

    if (!(node instanceof HTMLAnchorElement)) return
    const file = files.get(node)

    if (file) {
      node.dataset.localLink = file
      node.setAttribute("role", "link")
      node.tabIndex = 0
    }

    const href = appLinks.get(node)

    // Never restore a stripped href. Preserve the original as inert text, including characters DOMPurify or the
    // URL parser might trim: the desktop policy checks exactly what the author wrote.
    if (href !== undefined) {
      node.dataset.appLink = href

      // Strip authored inline styling from the label, but retain inert renderer slots; they contain no author HTML.
      for (const child of Array.from(node.querySelectorAll("*")).reverse()) {
        if (child.localName === "span" && /^[0-9a-f]{32}$/.test(child.id) && !child.hasChildNodes()) continue
        child.replaceWith(...child.childNodes)
      }

      if (!node.hasAttribute("href")) {
        node.removeAttribute("tabindex")
        node.removeAttribute("role")
      }
    }

    if (node.target !== "_blank") return

    if (/^https?:$/.test(node.protocol)) node.classList.add("external-link")

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

function contentWidth(value: string, attribute: boolean) {
  const match = /^(\d+(?:\.\d+)?)(px|%)?$/i.exec(value.trim())

  if (!match) return ""
  const unit = match[2] === "%" ? "%" : attribute ? "" : "px"

  return `${Math.min(Number(match[1]), unit === "%" ? 100 : 2048)}${unit}`
}

// Colors and plain numbers only: a paint value can reference another element (`url(#id)`), which may be outside the message.
function svgPaint(name: string, value: string) {
  if (name === "fill" || name === "stroke")
    return /^(?:[a-z]+|#[\da-f]{3,8}|(?:rgba?|hsla?)\([\d.%, /+-]{1,64}\))$/i.test(value)

  if (name === "stroke-linecap" || name === "stroke-linejoin") return /^(?:butt|round|square|bevel|miter)$/.test(value)

  if (name === "stroke-dasharray" || name === "stroke-dashoffset") return /^(?:none|[\d., -]{1,128})$/.test(value)

  return /^\d*\.?\d+$/.test(value) && Number(value) <= (name.endsWith("opacity") ? 1 : 64)
}

export function sanitizeMarkdown(html: MarkdownHTML) {
  if (!purifier.isSupported) return ""
  const template = document.createElement("template")
  // SAFETY: MarkdownHTML is the worker's typed union; strings have no out-of-band fragments.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
  const plain = typeof html === "string"
  template.content.append(purifier.sanitize(plain ? html : html.html, { RETURN_DOM_FRAGMENT: true }))

  if (plain) return template.innerHTML

  for (const [key, output] of html.fragments) {
    // Replace the complete slot, never bless it or its children. Author input cannot populate the worker's map.
    const slot = template.content.getElementById(`user-content-${key}`)

    if (!slot) continue
    slot.replaceWith(rendererFragment(output))
  }

  return template.innerHTML
}

// A streamed block is sanitized again on every delta while its formulas and code stay the same.
function rendererFragment(output: string) {
  const kept = renderedFragments.get(output)

  if (kept) {
    renderedFragments.delete(output)
    renderedFragments.set(output, kept)

    return kept.cloneNode(true)
  }

  const fragment = rendered.sanitize(output, { RETURN_DOM_FRAGMENT: true })
  renderedFragments.set(output, fragment.cloneNode(true))

  if (renderedFragments.size > 64) renderedFragments.delete(renderedFragments.keys().next().value ?? "")

  return fragment
}

/** Only the desktop session installs a reviewer for inert application targets. */
export function enableMarkdownAppLinks(source: ParentNode) {
  source.querySelectorAll<HTMLAnchorElement>("a[data-app-link]").forEach((anchor) => {
    anchor.setAttribute("role", "link")
    anchor.tabIndex = 0
  })
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

type WarmBlock = { text: string; cacheKey: string }

// Blocks to render into the cache while the main thread is idle, nearest first.
let warming: readonly WarmBlock[] = []

// Whether a callback is waiting to render them.
let warmScheduled = false

/**
 * Renders small Markdown blocks into the cache while the main thread is idle, so a row that shows one mounts without
 * parsing or sanitizing it. A later call replaces the blocks still waiting.
 */
export function prewarmMarkdown(blocks: readonly WarmBlock[]) {
  warming = blocks

  if (warmScheduled || blocks.length === 0) return
  warmScheduled = true

  // Safari has no idle callbacks; a timer that renders one block keeps each task short there.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- feature detection
  if (typeof requestIdleCallback === "undefined") return void setTimeout(warm, 200)
  requestIdleCallback(warm)
}

function warm(deadline?: IdleDeadline) {
  warmScheduled = false
  let done = 0

  // One block for each callback, then as many as the idle period has time left for.
  do {
    const block = warming[done++]

    // The same block and key a completed `Markdown` reads when it mounts.
    if (block) getReadyMarkdown({ raw: block.text, src: block.text }, `${block.cacheKey}:0:full`)
  } while (done < warming.length && deadline && deadline.timeRemaining() >= 1)

  prewarmMarkdown(warming.slice(done))
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
  html: MarkdownHTML,
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
