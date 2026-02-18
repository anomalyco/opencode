import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/util/encode"
import { ComponentProps, createEffect, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"

type Entry = {
  hash: string
  html: string
}

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
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
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
    if (wrapped) return
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

  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureWrapper(block)
  }
  markCodeLinks()

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

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "class", "classList"])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [html] = createResource(
    () => local.text,
    async (markdown) => {
      if (isServer) return ""

      const normalized = normalize(markdown)

      const hash = checksum(normalized)
      const key = local.cacheKey ?? hash

      if (key && hash) {
        const cached = cache.get(key)
        if (cached && cached.hash === hash) {
          touch(key, cached)
          return cached.html
        }
      }

      const next = await marked.parse(normalized)
      const safe = sanitize(next)
      if (key && hash) touch(key, { hash, html: safe })
      return safe
    },
    { initialValue: "" },
  )

  let copySetupTimer: ReturnType<typeof setTimeout> | undefined
  let copyCleanup: (() => void) | undefined

  createEffect(() => {
    const container = root()
    const content = html()
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      return
    }

    const temp = document.createElement("div")
    temp.innerHTML = content

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.isEqualNode(toEl)) return false
        if (fromEl.getAttribute("data-component") === "markdown-code") {
          const fromPre = fromEl.querySelector("pre")
          const toPre = toEl.querySelector("pre")
          if (fromPre && toPre && !fromPre.isEqualNode(toPre)) {
            morphdom(fromPre, toPre)
          }
          return false
        }
        return true
      },
      onBeforeNodeDiscarded: (node) => {
        if (node instanceof Element) {
          if (node.getAttribute("data-slot") === "markdown-copy-button") return false
          if (node.getAttribute("data-component") === "markdown-code") return false
        }
        return true
      },
    })

    if (copySetupTimer) clearTimeout(copySetupTimer)
    copySetupTimer = setTimeout(() => {
      if (copyCleanup) copyCleanup()
      copyCleanup = setupCodeCopy(container, {
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      })
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
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
