import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/util/encode"
import {
  ComponentProps,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  untrack,
} from "solid-js"
import { isServer } from "solid-js/web"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()
const debugKey = "opencode:debug:markdown"
let seq = 0

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

function debug() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(debugKey) === "1" || document.documentElement.dataset.debugMarkdown === "1"
}

function log(id: number, event: string, data?: unknown) {
  if (!debug()) return
  if (data === undefined) {
    console.log(`[markdown:${id}] ${event}`)
    return
  }
  console.log(`[markdown:${id}] ${event}`, data)
}

function count(root: ParentNode, sel: string) {
  return root.querySelectorAll(sel).length
}

function info(node: Node) {
  if (!(node instanceof Element)) return node.nodeName
  return {
    tag: node.tagName.toLowerCase(),
    class: node.className,
    slot: node.getAttribute("data-slot"),
    part: node.getAttribute("data-part"),
    role: node.getAttribute("role"),
  }
}

type CopyLabels = {
  copy: string
  copied: string
}

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("data-tooltip", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("data-tooltip", labels.copy)
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function decorate(root: HTMLDivElement, labels: CopyLabels) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
  markCodeLinks(root)
}

function labelsEqual(root: HTMLDivElement, labels: CopyLabels) {
  return root.dataset.copyLabel === labels.copy && root.dataset.copiedLabel === labels.copied
}

function setLabels(root: HTMLDivElement, labels: CopyLabels) {
  root.dataset.copyLabel = labels.copy
  root.dataset.copiedLabel = labels.copied
}

function setupCodeCopy(root: HTMLDivElement, labels: CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const ensureWrapper = (block: HTMLPreElement) => {
    const parent = block.parentElement
    if (!parent) return
    const wrapped = parent.getAttribute("data-component") === "markdown-code"
    if (wrapped) {
      if (!parent.querySelector('[data-slot="markdown-copy-button"]')) {
        parent.appendChild(createCopyButton(labels))
      }
      return
    }
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
  }

  const markCodeLinks = () => {
    const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
    for (const code of codeNodes) {
      const href = codeUrl(code.textContent ?? "")
      const parentLink =
        code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
          ? code.parentElement
          : null

      if (!href) {
        if (parentLink) parentLink.replaceWith(code)
        continue
      }

      if (parentLink) {
        parentLink.href = href
        continue
      }

      const link = document.createElement("a")
      link.href = href
      link.className = "external-link"
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      code.parentNode?.replaceChild(link, code)
      link.appendChild(code)
    }
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  decorate(root, labels)

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

function wrapCodeBlocks(container: HTMLElement) {
  for (const block of Array.from(container.querySelectorAll("pre"))) {
    const parent = block.parentElement
    if (!parent) continue
    if (parent.getAttribute("data-component") === "markdown-code") continue
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
  }
}

function normalize(text: string) {
  const ws = /[\t \u00A0\u200B\u3000]/

  const fix = (s: string) => {
    const strong = (m: string, pre: string, body: string, post: string) => {
      if (!pre && !post) return m
      const inner = `${pre}${body}${post}`
      const trimmed = inner.replace(new RegExp(`^(?:${ws.source})+|(?:${ws.source})+$`, "g"), "")
      if (!trimmed) return m
      return `**${trimmed}**`
    }

    const underline = (m: string, pre: string, body: string, post: string) => {
      if (!pre && !post) return m
      const inner = `${pre}${body}${post}`
      const trimmed = inner.replace(new RegExp(`^(?:${ws.source})+|(?:${ws.source})+$`, "g"), "")
      if (!trimmed) return m
      return `__${trimmed}__`
    }

    return s
      .replace(/\*\*([\t \u00A0\u200B\u3000]*)([^\n]*?)([\t \u00A0\u200B\u3000]*)\*\*/g, strong)
      .replace(/__([\t \u00A0\u200B\u3000]*)([^\n]*?)([\t \u00A0\u200B\u3000]*)__/g, underline)
  }

  const fence = (at: number, line: number) => {
    const ch = text[at]
    if (ch !== "`" && ch !== "~") return
    if (at - line > 3) return
    for (let k = line; k < at; k++) {
      if (text[k] !== " ") return
    }

    let n = 0
    while (text[at + n] === ch) n++
    if (n < 3) return

    let i = text.indexOf("\n", at)
    if (i === -1) return { from: line, to: text.length }

    for (;;) {
      const next = i + 1
      if (next >= text.length) return

      let j = next
      while (j < text.length && j - next <= 3 && text[j] === " ") j++

      let run = 0
      while (text[j + run] === ch) run++
      if (run >= n) {
        const end = text.indexOf("\n", j + run)
        return { from: line, to: end === -1 ? text.length : end + 1 }
      }

      i = text.indexOf("\n", next)
      if (i === -1) return
    }
  }

  const code = (at: number) => {
    if (text[at] !== "`") return
    let n = 0
    while (text[at + n] === "`") n++
    const mark = "`".repeat(n)
    const end = text.indexOf(mark, at + n)
    if (end === -1) return
    return { from: at, to: end + n }
  }

  let out = ""
  let from = 0
  let line = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "\n") {
      line = i + 1
      continue
    }

    const block = fence(i, line)
    if (block) {
      out += fix(text.slice(from, block.from))
      out += text.slice(block.from, block.to)
      i = block.to - 1
      from = block.to
      line = block.to
      continue
    }

    const inline = code(i)
    if (inline) {
      out += fix(text.slice(from, inline.from))
      out += text.slice(inline.from, inline.to)
      i = inline.to - 1
      from = inline.to
    }
  }

  out += fix(text.slice(from))
  return out
}

function math(el: Element) {
  return (
    el.classList.contains("katex") ||
    el.classList.contains("katex-display") ||
    el.classList.contains("katex-html") ||
    el.classList.contains("katex-mathml")
  )
}

// Debounce delay before upgrading from fast parse to full parse (with shiki)
const HIGHLIGHT_DEBOUNCE_MS = 600

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    eager?: boolean
    class?: string
    classList?: Record<string, boolean>
    streaming?: boolean
  },
) {
  const id = ++seq
  const [local, others] = splitProps(props, ["text", "cacheKey", "eager", "class", "classList", "streaming"])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [ready, setReady] = createSignal(isServer || local.eager !== false)
  const labels = createMemo(() => ({
    copy: i18n.t("ui.message.copy"),
    copied: i18n.t("ui.message.copied"),
  }))

  // Track whether we used fast parse (no shiki) for the current content
  let usedFastParse = false
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  // Monotonically increasing generation counter to discard stale full-parse results
  let parseGeneration = 0

  const [html, { mutate: setHtml }] = createResource(
    () => (ready() ? local.text : undefined),
    async (markdown) => {
      if (!markdown) return ""
      if (isServer) return fallback(markdown)

      const normalized = normalize(markdown)

      const hash = checksum(normalized)
      const key = local.cacheKey ?? hash
      const start = performance.now()

      if (key && hash) {
        const cached = cache.get(key)
        if (cached && cached.hash === hash) {
          log(id, "render cache hit", { key, hash, text: markdown.length, html: cached.html.length })
          touch(key, cached)
          usedFastParse = false
          return cached.html
        }
      }

      // During streaming, use fast parse (no shiki highlighting) to reduce main thread blocking
      const streaming = local.streaming
      const parseFn = streaming && marked.parseFast ? marked.parseFast : marked.parse

      let safe = ""
      try {
        log(id, streaming ? "render parse (fast)" : "render parse", { key, hash, text: markdown.length })
        safe = sanitize(await parseFn(normalized))
      } catch (err) {
        console.error("markdown render failed", err)
        safe = fallback(normalized)
      }
      log(id, "render done", { key, hash, html: safe.length, ms: Math.round(performance.now() - start) })

      if (streaming) {
        usedFastParse = true
        // Don't cache fast-parsed results — they lack syntax highlighting
      } else {
        usedFastParse = false
        if (key && hash) touch(key, { hash, html: safe })
      }

      return safe
    },
    { initialValue: isServer ? fallback(local.text) : "" },
  )

  // When streaming stops, schedule a full re-parse with shiki highlighting
  createEffect(() => {
    const streaming = local.streaming
    const text = local.text

    if (highlightTimer) {
      clearTimeout(highlightTimer)
      highlightTimer = undefined
    }

    if (!streaming && usedFastParse && text) {
      const gen = ++parseGeneration
      highlightTimer = setTimeout(async () => {
        try {
          const normalized = normalize(text)
          const hash = checksum(normalized)
          const key = local.cacheKey ?? hash
          log(id, "render upgrade (full shiki)", { key, text: text.length })
          const safe = sanitize(await marked.parse(normalized))
          // Only apply if content hasn't changed since we scheduled the upgrade
          if (gen === parseGeneration) {
            setHtml(safe)
            usedFastParse = false
            if (key && hash) touch(key, { hash, html: safe })
          }
        } catch (err) {
          console.error("markdown highlight upgrade failed", err)
        }
      }, HIGHLIGHT_DEBOUNCE_MS)
    }
  })

  let copySetupTimer: ReturnType<typeof setTimeout> | undefined
  let copyCleanup: (() => void) | undefined
  let obs: MutationObserver | undefined

  onMount(() => {
    if (isServer) return
    if (local.eager !== false) {
      setReady(true)
      return
    }

    const container = root()
    if (!container) return
    if (typeof IntersectionObserver === "undefined") {
      setReady(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setReady(true)
        io.disconnect()
      },
      { rootMargin: "300px 0px" },
    )

    io.observe(container)
    onCleanup(() => io.disconnect())
  })

  createEffect(() => {
    const container = root()
    if (!container) return
    container.dataset.markdownId = String(id)

    if (obs) {
      obs.disconnect()
      obs = undefined
    }

    obs = new MutationObserver((list) => {
      if (!debug()) return
      log(id, "dom mutate", {
        count: list.length,
        sample: list.slice(0, 3).map((item) => ({
          type: item.type,
          target: info(item.target),
          attr: item.attributeName,
          added: item.addedNodes.length,
          removed: item.removedNodes.length,
        })),
      })
    })

    obs.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })

    log(id, "mount", {
      key: local.cacheKey,
      text: local.text.length,
      katex: count(container, ".katex, .katex-display"),
    })
  })

  createEffect(() => {
    const container = root()
    const content = html()
    if (!container) return
    if (isServer) return

    if (!content) {
      log(id, "patch clear")
      container.innerHTML = ""
      delete container.dataset.html
      return
    }

    if (container.dataset.html === content) {
      log(id, "patch skip same html", {
        html: content.length,
        katex: count(container, ".katex, .katex-display"),
      })
      return
    }

    const next = untrack(labels)
    const prevHtml = container.dataset.html ?? ""
    const isStreaming = local.streaming

    // Fast-append path: during streaming, if new HTML starts with the previous HTML,
    // find the common top-level node boundary and only morphdom the tail.
    if (isStreaming && prevHtml && content.startsWith(prevHtml.slice(0, Math.max(0, prevHtml.lastIndexOf("<"))))) {
      // Find how many top-level children are stable
      const existingCount = container.childNodes.length
      if (existingCount > 0) {
        const temp = document.createElement("div")
        temp.innerHTML = content
        wrapCodeBlocks(temp)
        const newCount = temp.childNodes.length

        // Check how many leading children are identical
        let stableCount = 0
        const limit = Math.min(existingCount, newCount)
        for (let i = 0; i < limit - 1; i++) {
          const existing = container.childNodes[i]
          const incoming = temp.childNodes[i]
          if (existing && incoming && existing.isEqualNode(incoming)) {
            stableCount++
          } else {
            break
          }
        }

        if (stableCount > 0 && stableCount >= existingCount - 1) {
          log(id, "patch incremental", {
            stable: stableCount,
            existing: existingCount,
            incoming: newCount,
          })

          // Remove unstable trailing nodes from container
          while (container.childNodes.length > stableCount) {
            container.removeChild(container.lastChild!)
          }
          // Append all nodes from stableCount onward from temp
          while (temp.childNodes.length > stableCount) {
            const node = temp.childNodes[stableCount]
            container.appendChild(node)
          }

          container.dataset.html = content

          if (copySetupTimer) clearTimeout(copySetupTimer)
          copySetupTimer = setTimeout(() => {
            if (copyCleanup) copyCleanup()
            copyCleanup = setupCodeCopy(container, next)
            setLabels(container, next)
          }, 150)
          return
        }
      }
    }

    // Full morphdom path
    const temp = document.createElement("div")
    temp.innerHTML = content
    wrapCodeBlocks(temp)
    let same = 0
    let keep = 0

    log(id, "patch start", {
      prev: prevHtml.length,
      next: content.length,
      katex: {
        from: count(container, ".katex, .katex-display"),
        to: count(temp, ".katex, .katex-display"),
      },
    })

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.isEqualNode(toEl)) {
          same++
          return false
        }
        if (math(fromEl) && math(toEl)) {
          keep++
          log(id, "patch keep math", {
            from: info(fromEl),
            to: info(toEl),
          })
          return false
        }
        return true
      },
    })

    container.dataset.html = content
    log(id, "patch done", {
      same,
      keep,
      katex: count(container, ".katex, .katex-display"),
    })

    if (copySetupTimer) clearTimeout(copySetupTimer)
    copySetupTimer = setTimeout(() => {
      if (copyCleanup) copyCleanup()
      copyCleanup = setupCodeCopy(container, next)
      setLabels(container, next)
      log(id, "copy setup", {
        buttons: count(container, '[data-slot="markdown-copy-button"]'),
      })
    }, 150)
  })

  createEffect(() => {
    const container = root()
    const next = labels()
    if (!container) return
    if (isServer) return
    if (!container.dataset.html) return
    if (labelsEqual(container, next)) {
      log(id, "labels skip")
      return
    }

    if (copySetupTimer) clearTimeout(copySetupTimer)
    copySetupTimer = setTimeout(() => {
      if (copyCleanup) copyCleanup()
      copyCleanup = setupCodeCopy(container, next)
      setLabels(container, next)
      log(id, "labels update", next)
    }, 150)
  })

  onCleanup(() => {
    log(id, "cleanup")
    obs?.disconnect()
    if (copySetupTimer) clearTimeout(copySetupTimer)
    if (copyCleanup) copyCleanup()
    if (highlightTimer) clearTimeout(highlightTimer)
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
