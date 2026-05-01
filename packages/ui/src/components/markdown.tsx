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
  on,
  onCleanup,
  onMount,
  splitProps,
  untrack,
} from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"

type Entry = {
  hash: string
  html: string
}

type MarkedApi = ReturnType<typeof useMarked>

const max = 200
const cache = new Map<string, Entry>()

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
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

function clip(text: string, size = 40) {
  return JSON.stringify(text.slice(-size))
}

function view(node: HTMLElement) {
  return node.closest(".scroll-view__viewport,[data-slot='session-turn-content']") as HTMLElement | null
}

function snap(node: HTMLElement | null) {
  if (!node) return
  const max = Math.max(0, node.scrollHeight - node.clientHeight)
  return {
    top: Math.round(node.scrollTop),
    height: Math.round(node.scrollHeight),
    client: Math.round(node.clientHeight),
    max: Math.round(max),
    gap: Math.round(max - node.scrollTop),
  }
}

type CopyLabels = {
  copy: string
  copied: string
}

export type FileLink = {
  path: string
  line?: number
  col?: number
}

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/
const filePattern =
  /(^|[\s([{"'])((?:\.{1,2}[\\/]|~[\\/]|\/|[A-Za-z]:[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+(?:\:\d+(?:-\d+)?(?:\:\d+)?)?(?:#L\d+(?:C\d+)?)?)/g

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

function stripFileSuffix(text: string) {
  return text.replace(/[),.;!?]+$/, "")
}

export function fileLink(text: string) {
  const raw = stripFileSuffix(text.trim())
  if (!raw) return
  if (raw.includes("://")) return
  if (!/[\\/]/.test(raw)) return
  if (/\s/.test(raw)) return

  const hash = raw.match(/#L(\d+)(?:C(\d+))?$/i)
  const hashLine = hash?.[1] ? Number(hash[1]) : undefined
  const hashCol = hash?.[2] ? Number(hash[2]) : undefined
  const base = hash ? raw.slice(0, -hash[0].length) : raw
  const win = /^[A-Za-z]:[\\/]/.test(base)
  const line = base.match(/:(\d+)(?:-(\d+))?(?::(\d+))?$/)
  const path = line && (!win || base.indexOf(":") !== 1) ? base.slice(0, -line[0].length) : base
  const next = path.replace(/[\\/]+$/, "")
  if (!next || !/[\\/]/.test(next)) return
  if (/^\d+\/\d+$/.test(next)) return

  const parts = next.split("/").filter(Boolean)
  if (parts.length < 2) return

  const rooted = next.startsWith("./") || next.startsWith("../") || next.startsWith("~/") || next.startsWith("/") || win
  const named = parts.some((part) => /[._-]/.test(part))
  if (!rooted && !named) return

  const link = {
    path: path.replace(/\\/g, "/"),
    line: hashLine ?? (line?.[1] ? Number(line[1]) : undefined),
    col: hashCol ?? (line?.[3] ? Number(line[3]) : undefined),
  }

  if (link.line !== undefined && (!Number.isInteger(link.line) || link.line <= 0)) return
  if (link.col !== undefined && (!Number.isInteger(link.col) || link.col <= 0)) return
  return link
}

function fileHref(link: FileLink) {
  const line = link.line ? `:${link.line}${link.col ? `:${link.col}` : ""}` : ""
  return `opencode-file:${encodeURIComponent(`${link.path}${line}`)}`
}

function applyFileLink(node: HTMLAnchorElement, link: FileLink) {
  node.href = fileHref(link)
  node.dataset.fileLink = ""
  node.dataset.path = link.path
  if (link.line) node.dataset.line = String(link.line)
  else delete node.dataset.line
  if (link.col) node.dataset.col = String(link.col)
  else delete node.dataset.col
}

function markFileLinks(root: HTMLDivElement) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest("a, pre, code")) return NodeFilter.FILTER_REJECT
      if (!filePattern.test(node.textContent ?? "")) return NodeFilter.FILTER_REJECT
      filePattern.lastIndex = 0
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const list: Text[] = []
  while (walk.nextNode()) {
    if (walk.currentNode instanceof Text) list.push(walk.currentNode)
  }

  for (const node of list) {
    const text = node.data
    const frag = document.createDocumentFragment()
    let from = 0
    filePattern.lastIndex = 0
    let hit: RegExpExecArray | null

    while ((hit = filePattern.exec(text))) {
      const lead = hit[1] ?? ""
      const raw = hit[2] ?? ""
      const link = fileLink(raw)
      if (!link) continue
      const start = hit.index + lead.length
      const end = start + raw.length
      if (start > from) frag.append(text.slice(from, start))
      const a = document.createElement("a")
      applyFileLink(a, link)
      a.textContent = raw
      frag.append(a)
      from = end
    }

    if (from === 0) continue
    if (from < text.length) frag.append(text.slice(from))
    node.parentNode?.replaceChild(frag, node)
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
    const file = fileLink(code.textContent ?? "")
    const parent = code.parentElement instanceof HTMLAnchorElement ? code.parentElement : null
    if (file) {
      if (parent) {
        applyFileLink(parent, file)
        continue
      }

      const link = document.createElement("a")
      applyFileLink(link, file)
      code.parentNode?.replaceChild(link, code)
      link.appendChild(code)
      continue
    }

    const href = codeUrl(code.textContent ?? "")
    const parentLink = parent?.classList.contains("external-link") ? parent : null

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
  markFileLinks(root)
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
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
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
    const labels = getLabels()
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

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

function cacheMode(input: { highlight?: "full" | "defer"; chunked?: boolean; math?: "full" | "defer" }) {
  return [input.highlight ?? "full", input.math ?? "full", input.chunked ? "chunked" : "plain"].join(":")
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

function readLang(code: Element) {
  const cls = code.getAttribute("class") ?? ""
  const match = cls.match(/(?:^|\s)language-([^\s]+)/)
  return match?.[1]
}

async function upgradeNode(marked: MarkedApi, node: Element) {
  const host = document.createElement("div")
  host.innerHTML = marked.renderMath ? marked.renderMath(node.outerHTML) : node.outerHTML

  for (const code of Array.from(host.querySelectorAll("pre > code"))) {
    const pre = code.parentElement
    if (!(pre instanceof HTMLPreElement)) continue
    if (!marked.highlight) continue
    const html = await marked.highlight(code.textContent ?? "", readLang(code))
    const temp = document.createElement("div")
    temp.innerHTML = html
    const next = temp.firstElementChild
    if (!next) continue
    pre.replaceWith(next)
  }

  const frag = document.createDocumentFragment()
  for (const child of Array.from(host.childNodes)) {
    frag.appendChild(child)
  }
  node.replaceWith(frag)
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
const HIGHLIGHT_IDLE_TIMEOUT_MS = 4_000
const DOM_WARN_MS = 50

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    plain?: boolean
    eager?: boolean
    viewport?: HTMLElement
    class?: string
    classList?: Record<string, boolean>
    streaming?: boolean
    instant?: boolean
    highlight?: "full" | "defer"
    chunked?: boolean
    math?: "full" | "defer"
  },
) {
  const [local, others] = splitProps(props, [
    "text",
    "cacheKey",
    "plain",
    "eager",
    "viewport",
    "class",
    "classList",
    "streaming",
    "instant",
    "highlight",
    "chunked",
    "math",
  ])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [ready, setReady] = createSignal(true)
  const [seen, setSeen] = createSignal(!!local.eager)
  const [mathSeen, setMathSeen] = createSignal(!!local.eager || local.math !== "defer")
  const labels = createMemo(() => ({
    copy: i18n.t("ui.message.copy"),
    copied: i18n.t("ui.message.copied"),
  }))

  const visible = createMemo(() => local.eager || seen())
  const mathReady = createMemo(() => local.math !== "defer" || local.eager || mathSeen())
  const mode = createMemo<"full" | "fast" | "lite" | "plain">(() => {
    if (local.plain) return "plain"
    if (local.streaming) return "fast"
    if (!visible()) return "lite"
    return "full"
  })

  const src = createMemo(() => {
    if (!ready()) return
    const markdown = local.text
    const normalized = normalize(markdown)
    const hash = checksum(normalized)
    const cache = cacheMode({ highlight: local.highlight, chunked: local.chunked, math: local.math })
    const current = mode()
    const key = hash ? `${cache}:${current}:${hash}` : undefined
    return {
      markdown,
      normalized,
      hash,
      mode: current,
      key,
      cacheKey: local.cacheKey ? `${cache}:${current}:${local.cacheKey}` : undefined,
      streaming: !!local.streaming,
      highlight: local.highlight,
      chunked: local.chunked,
      math: mathReady() ? "full" : "defer",
    }
  })

  const [html, { mutate: setHtml }] = createResource(
    src,
    async (input) => {
      if (!input) return ""
      if (isServer) return fallback(input.markdown)

      const key = input.cacheKey ?? input.key
      if (key && input.hash) {
        const hit = cache.get(key)
        if (hit && hit.hash === input.hash) {
          touch(key, hit)
          return hit.html
        }
      }

      const rendered =
        input.mode === "plain"
          ? fallback(input.normalized)
          : await (
              input.mode === "lite"
                ? marked.parseLite
                : input.mode === "fast"
                  ? marked.parseFast
                  : input.math === "defer" && marked.parseNoMath
                    ? marked.parseNoMath
                    : marked.parse
            )(input.normalized).catch((err) => {
              console.error("markdown render failed", err)
              return fallback(input.normalized)
            })

      const safe = input.mode === "plain" ? rendered : sanitize(rendered)
      if (!input.streaming && key && input.hash) {
        touch(key, { hash: input.hash, html: safe })
      }
      return safe
    },
    { initialValue: isServer || local.instant ? fallback(local.text) : "" },
  )

  let copySetupTimer: ReturnType<typeof setTimeout> | undefined
  let copyCleanup: (() => void) | undefined
  let live = true
  let info = {
    key: local.cacheKey ?? "",
    text: local.text.length,
    streaming: !!local.streaming,
  }

  createEffect(() => {
    info = {
      key: local.cacheKey ?? "",
      text: local.text.length,
      streaming: !!local.streaming,
    }
  })

  onMount(() => {
    if (info.streaming) {
      console.debug("[markdown] mount", {
        key: info.key,
        text: info.text,
      })
    }
    setReady(true)
  })

  onCleanup(() => {
    live = false
    if (info.streaming) {
      console.debug("[markdown] cleanup", {
        key: info.key,
        text: info.text,
      })
    }
  })

  createEffect(
    on(
      () => [root(), local.viewport, local.eager] as const,
      ([container, viewport, eager]) => {
        if (!container || eager) {
          if (eager) setSeen(true)
          return
        }
        const observer = new IntersectionObserver(
          (entries) => {
            if (!live || !container.isConnected) {
              console.debug("[markdown] skip stale visible observer", {
                key: info.key,
                text: info.text,
              })
              return
            }
            if (!entries.some((entry) => entry.isIntersecting)) return
            setSeen(true)
          },
          {
            root: viewport,
            rootMargin: "800px 0px",
          },
        )
        observer.observe(container)
        onCleanup(() => observer.disconnect())
      },
    ),
  )

  createEffect(
    on(
      () => [root(), local.viewport, local.eager, local.math] as const,
      ([container, viewport, eager, math]) => {
        if (!container || eager || math !== "defer") {
          setMathSeen(true)
          return
        }
        const observer = new IntersectionObserver(
          (entries) => {
            if (!live || !container.isConnected) {
              console.debug("[markdown] skip stale math observer", {
                key: info.key,
                text: info.text,
              })
              return
            }
            if (!entries.some((entry) => entry.isIntersecting)) return
            setMathSeen(true)
          },
          {
            root: viewport,
            rootMargin: "200px 0px",
          },
        )
        observer.observe(container)
        onCleanup(() => observer.disconnect())
      },
    ),
  )

  createEffect(() => {
    const container = root()
    const content = html()
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      delete container.dataset.html
      return
    }

    if (container.dataset.html === content) return

    const next = untrack(labels)
    const prevHtml = container.dataset.html ?? ""
    const isStreaming = local.streaming
    const chunked = local.chunked
    const pane = isStreaming ? view(container) : null
    const before = isStreaming ? snap(pane) : undefined
    const time = performance.now()

    if (isStreaming && prevHtml && content.length < prevHtml.length) {
      console.warn("[markdown] html rollback", {
        key: local.cacheKey ?? "",
        prev: prevHtml.length,
        next: content.length,
        text: local.text.length,
        tail: clip(local.text),
      })
    }

    const done = (mode: string) => {
      const took = performance.now() - time
      container.dataset.html = content

      if (took > DOM_WARN_MS) {
        console.warn("[markdown] slow dom", {
          key: local.cacheKey ?? "",
          mode,
          streaming: isStreaming,
          text: local.text.length,
          prev: prevHtml.length,
          next: content.length,
          nodes: container.childNodes.length,
          took: Math.round(took),
        })
      }

      if (isStreaming && before) {
        const after = snap(pane)
        if (after) {
          const jump = after.top - before.top
          const shrink = after.height - before.height
          if (jump < -24) {
            console.warn("[markdown] scroll jump", {
              key: local.cacheKey ?? "",
              mode,
              jump,
              grow: shrink,
              htmlPrev: prevHtml.length,
              htmlNext: content.length,
              text: local.text.length,
              before,
              after,
            })
          }
        }
      }

      if (copySetupTimer) clearTimeout(copySetupTimer)
      copySetupTimer = setTimeout(() => {
        if (!live || !container.isConnected) {
          console.debug("[markdown] skip stale copy setup", {
            key: info.key,
            text: info.text,
          })
          return
        }
        if (copyCleanup) copyCleanup()
        copyCleanup = setupCodeCopy(container, next)
        setLabels(container, next)
      }, 150)
    }

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
          // Remove unstable trailing nodes from container
          while (container.childNodes.length > stableCount) {
            container.removeChild(container.lastChild!)
          }
          // Append all nodes from stableCount onward from temp
          while (temp.childNodes.length > stableCount) {
            const node = temp.childNodes[stableCount]
            container.appendChild(node)
          }
          done("append")
          return
        }
      }
    }

    // Chunked path prefers a simple replace on first mount to avoid expensive diffing.
    const temp = document.createElement("div")
    temp.innerHTML = content
    wrapCodeBlocks(temp)

    if (chunked && !prevHtml) {
      container.replaceChildren(...Array.from(temp.childNodes))
      done("replace")
      return
    }

    if (isStreaming && prevHtml) {
      const prefix = prevHtml.slice(0, Math.max(0, prevHtml.lastIndexOf("<")))
      if (prefix && !content.startsWith(prefix)) {
        console.warn("[markdown] non-prefix morph", {
          key: local.cacheKey ?? "",
          prev: prevHtml.length,
          next: content.length,
          old: container.childNodes.length,
          fresh: temp.childNodes.length,
          text: local.text.length,
          tail: clip(local.text),
        })
      }
    }

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.isEqualNode(toEl)) return false
        if (math(fromEl) && math(toEl)) return false
        return true
      },
    })
    done("morph")
  })

  createEffect(() => {
    const container = root()
    const next = labels()
    if (!container) return
    if (isServer) return
    if (!container.dataset.html) return
    if (labelsEqual(container, next)) return

    if (copySetupTimer) clearTimeout(copySetupTimer)
    copySetupTimer = setTimeout(() => {
      if (!live || !container.isConnected) {
        console.debug("[markdown] skip stale label sync", {
          key: info.key,
          text: info.text,
        })
        return
      }
      if (copyCleanup) copyCleanup()
      copyCleanup = setupCodeCopy(container, next)
      setLabels(container, next)
    }, 150)
  })

  onCleanup(() => {
    if (copySetupTimer) clearTimeout(copySetupTimer)
    if (copyCleanup) copyCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
