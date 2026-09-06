import { useI18n } from "@opencode-ai/ui/context/i18n"
import { checksum } from "@opencode-ai/util/encode"
import {
  type ComponentProps,
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
  onCleanup,
  type Setter,
  splitProps,
} from "solid-js"
import { isServer, render } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { canReusePendingBlock, completedProjection } from "./markdown-projection"
import type { Block, Projection } from "./markdown-stream"
import {
  disposeMarkdownProjection,
  disposeStreamingCode,
  highlightStreamingCode,
  MarkdownWorkerDisposedError,
  MarkdownWorkerSupersededError,
  MarkdownWorkerUnavailableError,
  projectMarkdown,
} from "./markdown-worker"
import { markdownBlockKey, type MarkdownToken } from "./markdown-worker-protocol"
import { shouldResetCodeTokens, type RenderedCodeState } from "./markdown-code-state"
import {
  getCachedMarkdown,
  getReadyMarkdown,
  renderCachedMarkdown,
  touchCachedMarkdown,
  type MarkdownCacheEntry,
} from "./markdown-cache"
import { inlineCodeKind } from "./markdown-inline-code-kind"
import { renderMermaidSvg } from "./markdown-mermaid"
import { createMarkdownRenderer } from "./markdown-solid"
import { useMarkdown, type ReadMarkdownImage } from "../context/markdown"
import { createMarkdownImages } from "./markdown-image"

type RenderedBlock =
  | (MarkdownCacheEntry & { key: string; mode: Exclude<Block["mode"], "code"> })
  | {
      key: string
      mode: "code"
      raw: string
      hash: string
      language: string
      complete: boolean
      generation: number
      stable: MarkdownToken[]
      unstable: MarkdownToken[]
    }

type RenderResult = {
  text: string
  blocks: RenderedBlock[]
  ready: boolean
}

const renderedCodeTokens = new WeakMap<HTMLDivElement, RenderedCodeState>()
const renderedMarkdown = new WeakMap<
  HTMLDivElement,
  { renderer: ReturnType<typeof createMarkdownRenderer>; raw: string }
>()

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

async function code(text: string, language: string | undefined, key: string, complete = false) {
  try {
    const result = await highlightStreamingCode(key, text, language ?? "text", complete)
    return {
      language: result.language,
      generation: result.generation,
      stable: result.stable,
      unstable: result.unstable,
    }
  } catch (error) {
    if (
      !(error instanceof MarkdownWorkerDisposedError) &&
      !(error instanceof MarkdownWorkerSupersededError) &&
      !(error instanceof MarkdownWorkerUnavailableError)
    )
      console.error("Markdown highlighting worker failed", error)
    return { language: language ?? "text", generation: 0, stable: [], unstable: [[text, ""] as MarkdownToken] }
  }
}

type CopyLabels = {
  copy: string
  copied: string
}

type CopyButtonState = {
  setLabels: Setter<CopyLabels>
  setCopied: Setter<boolean>
  dispose: () => void
}

const copyButtonState = new WeakMap<HTMLElement, CopyButtonState>()

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

function createCopyButton(labels: CopyLabels) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-copy-button")

  const state: Partial<CopyButtonState> = {}
  const dispose = render(() => {
    const [labelState, setLabels] = createSignal(labels, { equals: false })
    const [copied, setCopied] = createSignal(false)
    state.setLabels = setLabels
    state.setCopied = setCopied
    return <MarkdownCopyButton labels={labelState()} copied={copied()} />
  }, host)
  state.dispose = dispose
  copyButtonState.set(host, state as CopyButtonState)
  return host
}

function MarkdownCopyButton(props: { labels: CopyLabels; copied: boolean }) {
  const label = () => (props.copied ? props.labels.copied : props.labels.copy)
  return (
    <Tooltip placement="top" value={label()}>
      <IconButton
        type="button"
        size="normal"
        variant="ghost-muted"
        aria-label={label()}
        icon={
          <>
            <Icon name="outline-copy" data-copy-icon />
            <Icon name="check" data-check-icon />
          </>
        }
      />
    </Tooltip>
  )
}

function setCopyState(host: HTMLElement, labels: CopyLabels, copied: boolean) {
  const state = copyButtonState.get(host)
  state?.setLabels(labels)
  state?.setCopied(copied)
  if (copied) {
    host.setAttribute("data-copied", "true")
    return
  }
  host.removeAttribute("data-copied")
}

function disposeCopyButton(host: HTMLElement) {
  copyButtonState.get(host)?.dispose()
  copyButtonState.delete(host)
}

function disposeCopyButtons(root: Element) {
  const hosts = [
    ...(root instanceof HTMLElement && root.getAttribute("data-slot") === "markdown-copy-button" ? [root] : []),
    ...Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    ),
  ]
  hosts.forEach(disposeCopyButton)
}

function disposeRenderedMarkdown(root: Element) {
  const blocks = [
    ...(root instanceof HTMLDivElement && root.hasAttribute("data-markdown-block") ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLDivElement>("[data-markdown-block]")),
  ]
  blocks.forEach((block) => {
    renderedMarkdown.get(block)?.renderer.dispose()
    renderedMarkdown.delete(block)
  })
}

const shellLanguages = new Set(["bash", "sh", "shell", "zsh", "fish", "console", "terminal"])

function codeKind(language: string | undefined) {
  const value = language?.toLowerCase()
  if (!value) return
  if (shellLanguages.has(value)) return "shell"
}

function applyCodeMetadata(wrapper: HTMLElement, language: string | undefined) {
  if (language) wrapper.dataset.language = language
  else delete wrapper.dataset.language

  const kind = codeKind(language)
  if (kind) wrapper.dataset.codeKind = kind
  else delete wrapper.dataset.codeKind
}

function decorateMermaid(wrapper: HTMLElement, code: HTMLElement, complete: boolean) {
  if (!code.classList.contains("language-mermaid")) {
    clearMermaid(wrapper)
    return
  }

  const source = code.textContent ?? ""
  if (!source) return
  const diagram = wrapper.querySelector('[data-component="markdown-mermaid"]') ?? document.createElement("div")
  diagram.setAttribute("data-component", "markdown-mermaid")
  if (!diagram.parentElement) wrapper.appendChild(diagram)
  wrapper.dataset.mermaidPending = "true"
  const input = complete ? source : source.slice(0, source.lastIndexOf("\n") + 1)
  if (!input) return
  const attempt = `${complete ? "complete" : "streaming"}:${input.length}`
  if (wrapper.dataset.mermaidAttempt === attempt) return
  wrapper.dataset.mermaidAttempt = attempt
  void renderMermaidSvg(input)
    .then((svg) => {
      if (!svg) {
        if (complete && code.textContent === source) clearMermaid(wrapper)
        return
      }
      if (!(code.textContent ?? "").startsWith(input)) return
      diagram.innerHTML = svg
      delete wrapper.dataset.mermaidPending
      wrapper.dataset.mermaidReady = "true"
    })
    .catch(() => {
      if (!complete || code.textContent !== source) return
      clearMermaid(wrapper)
    })
}

function clearMermaid(wrapper: HTMLElement) {
  delete wrapper.dataset.mermaidAttempt
  delete wrapper.dataset.mermaidPending
  delete wrapper.dataset.mermaidReady
  wrapper.querySelector('[data-component="markdown-mermaid"]')?.remove()
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

function markInlineCode(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    if (!(code instanceof HTMLElement)) continue
    delete code.dataset.inlineCodeKind
    const kind = inlineCodeKind(code.textContent ?? "")
    if (kind) code.dataset.inlineCodeKind = kind
  }
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLElement)) return
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
    if (button instanceof HTMLElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
    disposeCopyButtons(root)
  }
}

function initialResult(
  text: string,
  key: string | undefined,
  projection: Projection,
  owner: string,
  deferUntilReady: boolean | undefined,
): RenderResult {
  if (!text) return { text, blocks: [], ready: true }
  const base = key ?? checksum(text)
  if (base) {
    const blocks = projection.blocks.flatMap((block, index) => {
      if (block.mode === "code") return []
      const cacheKey = `${base}:${index}:${block.mode}`
      const cached = block.mode === "full" ? getReadyMarkdown(block, cacheKey) : getCachedMarkdown(cacheKey)
      if (cached?.raw !== block.raw) return []
      if (block.mode !== "full") touchCachedMarkdown(cacheKey, cached)
      return [{ key: `${owner}:${cacheKey}`, mode: block.mode, ...cached }]
    })
    if (blocks.length === projection.blocks.length) return { text, blocks, ready: true }
  }
  if (deferUntilReady) return { text, blocks: [], ready: false }
  return {
    text,
    ready: false,
    blocks: [
      {
        key: "initial",
        mode: "full",
        raw: text,
        hash: checksum(text) ?? "",
        html: fallback(text),
      },
    ],
  }
}

function pendingProjection(text: string): Projection {
  return { text, blocks: text ? [{ raw: text, src: text, mode: "live" }] : [] }
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    deferUntilReady?: boolean
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "streaming", "deferUntilReady", "class", "classList"])
  const i18n = useI18n()
  const markdown = useMarkdown()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const owner = createUniqueId()
  const lifetime = new AbortController()
  const activeCodeKeys = new Set<string>()
  const completedCode = new Map<string, Extract<RenderedBlock, { mode: "code" }>>()
  let streamed = false
  const [projection] = createResource(
    () => {
      if (isServer) return
      const live = local.streaming ?? false
      if (live) streamed = true
      if (!live && !streamed) return
      return { key: owner, text: local.text, live }
    },
    (src) => projectMarkdown(src.key, src.text, src.live),
    { initialValue: pendingProjection("") },
  )
  const currentProjection = () => {
    if (!(local.streaming ?? false) && !streamed) return completedProjection(local.text)
    const value = projection.latest
    if (value?.text === local.text) return value
    if (value?.text) return value
    return pendingProjection(local.text)
  }
  const initial = initialResult(
    local.text,
    local.cacheKey,
    local.streaming ? pendingProjection(local.text) : completedProjection(local.text),
    owner,
    local.deferUntilReady,
  )
  const [html] = createResource(
    () => {
      if (isServer)
        return {
          text: local.text,
          key: local.cacheKey,
          projection: pendingProjection(local.text),
        }
      const value = !(local.streaming ?? false) && !streamed ? completedProjection(local.text) : projection.latest
      if (!value || value.text !== local.text) return
      return {
        text: local.text,
        key: local.cacheKey,
        projection: value,
      }
    },
    (src): RenderResult | Promise<RenderResult> => {
      if (isServer)
        return {
          text: src.text,
          ready: true,
          blocks: [
            {
              key: "server",
              mode: "full" as const,
              raw: src.text,
              hash: checksum(src.text) ?? "",
              html: fallback(src.text),
            },
          ],
        } satisfies RenderResult
      if (!src.text) return { text: src.text, blocks: [], ready: true } satisfies RenderResult
      if (!streamed && initial.ready && initial.text === src.text) return initial

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        src.projection.blocks.map(async (block, index) => {
          const key = base ? `${base}:${index}:${block.mode}` : undefined
          const blockKey = markdownBlockKey(owner, src.key, index, block.mode)

          if (block.mode === "code") {
            const cached = completedCode.get(blockKey)
            if (block.complete && cached?.raw === block.raw) return cached
            const result = await code(block.src, block.language, blockKey, block.complete)
            const rendered = {
              key: blockKey,
              mode: block.mode,
              raw: block.raw,
              hash: String(block.raw.length),
              complete: !!block.complete,
              ...result,
            }
            if (block.complete) completedCode.set(blockKey, rendered)
            return rendered
          }

          const ready = block.mode === "full" ? getReadyMarkdown(block, key) : undefined
          return {
            key: blockKey,
            mode: block.mode,
            ...(ready ?? (await renderCachedMarkdown(block, key, lifetime.signal))),
          }
        }),
      )
        .then((blocks) => ({ text: src.text, blocks, ready: true }) satisfies RenderResult)
        .catch(
          () =>
            (lifetime.signal.aborted
              ? { text: src.text, blocks: [], ready: false }
              : {
                  text: src.text,
                  ready: true,
                  blocks: [
                    {
                      key: base ?? "fallback",
                      mode: "full" as const,
                      raw: src.text,
                      hash: checksum(src.text) ?? "",
                      html: fallback(src.text),
                    },
                  ],
                }) satisfies RenderResult,
        )
    },
    { initialValue: initial },
  )

  let copyCleanup: (() => void) | undefined
  let readImage: ReadMarkdownImage | undefined
  let images: ReturnType<typeof createMarkdownImages> | undefined

  createEffect(() => {
    const container = root()
    const result = html.latest ?? html()
    const projected = currentProjection()
    const content = local.text ? pendingBlocks(result, projected, local.cacheKey, owner, local.deferUntilReady) : []
    if (!container) return
    if (isServer) return
    if (readImage !== markdown?.readImage) {
      images?.dispose()
      readImage = markdown?.readImage
      images = readImage ? createMarkdownImages(readImage) : undefined
    }
    delete container.dataset.markdownReady
    if (content.length === 0) {
      disposeCopyButtons(container)
      disposeRenderedMarkdown(container)
      container.innerHTML = ""
      images?.update(container)
      if (result?.ready && result.text === local.text) container.dataset.markdownReady = ""
      return
    }

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
    }
    const nextCodeKeys = new Set(content.filter((block) => block.mode === "code").map((block) => block.key))
    activeCodeKeys.forEach((key) => {
      if (!nextCodeKeys.has(key)) disposeCode(key)
    })
    activeCodeKeys.clear()
    nextCodeKeys.forEach((key) => activeCodeKeys.add(key))
    content.forEach((block, index) => updateBlock(container, index, block, labels))
    while (container.children.length > content.length) {
      const child = container.lastElementChild
      if (!child) break
      disposeCopyButtons(child)
      disposeRenderedMarkdown(child)
      child.remove()
    }
    images?.update(container)
    container
      .querySelectorAll<HTMLElement>('[data-slot="markdown-copy-button"]')
      .forEach((button) => setCopyState(button, labels, button.dataset.copied === "true"))
    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      }))
    if (result?.ready && result.text === local.text) container.dataset.markdownReady = ""
  })

  onCleanup(() => {
    lifetime.abort()
    images?.dispose()
    if (copyCleanup) copyCleanup()
    const container = root()
    if (container) disposeRenderedMarkdown(container)
    if (streamed) disposeMarkdownProjection(owner)
    activeCodeKeys.forEach(disposeCode)
    completedCode.clear()
  })

  return (
    <div
      data-component="markdown"
      dir="auto"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}

function pendingBlocks(
  result: RenderResult | undefined,
  projection: Projection | undefined,
  cacheKey: string | undefined,
  owner: string,
  deferUntilReady: boolean | undefined,
) {
  if (!result) return []
  if (!projection || result.text === projection.text) return result.blocks
  if (deferUntilReady) return result.blocks
  const initial = result.blocks.length === 1 && result.blocks[0]?.key === "initial"
  return projection.blocks.map((block, index) => {
    const current = initial ? undefined : result.blocks[index]
    if (current && canReusePendingBlock(current, block)) return current
    const key = markdownBlockKey(owner, cacheKey, index, block.mode)
    if (block.mode !== "code")
      return { key, mode: block.mode, raw: block.raw, hash: String(block.raw.length), html: fallback(block.src) }
    return {
      key,
      mode: block.mode,
      raw: block.raw,
      hash: String(block.raw.length),
      language: block.language ?? "text",
      complete: !!block.complete,
      stable: [],
      generation: 0,
      unstable: [[block.src, ""] as MarkdownToken],
    }
  })
}

function disposeCode(key: string) {
  disposeStreamingCode(key)
}

function updateBlock(container: HTMLDivElement, index: number, block: RenderedBlock, labels: CopyLabels) {
  const current = container.children[index]
  if (block.mode === "code") {
    updateCodeBlock(container, current, block, labels)
    return
  }
  const existing =
    current instanceof HTMLDivElement && current.dataset.markdownKey === block.key && !renderedCodeTokens.has(current)
      ? current
      : undefined
  if (existing?.dataset.markdownHash === block.hash) return

  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.style.display = "contents"
  const rendered = renderedMarkdown.get(next)
  // Keep live renderers in control of their DOM, including after completion.
  const source = rendered || block.mode === "live" ? document.createElement("div") : next
  if (source === next) disposeCopyButtons(next)
  source.innerHTML = block.html
  markInlineCode(source)
  markCodeLinks(source)

  if (rendered) {
    rendered.renderer.update(source.innerHTML, block.mode === "live", rendered.raw !== block.raw)
    rendered.raw = block.raw
    return
  }
  if (block.mode === "live") {
    next.replaceChildren()
    renderedMarkdown.set(next, {
      renderer: createMarkdownRenderer(next, source.innerHTML, true),
      raw: block.raw,
    })
  }
  if (block.mode !== "live") {
    next.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
      const pre = code.parentElement!
      const wrapper = document.createElement("div")
      wrapper.dataset.component = "markdown-code"
      applyCodeMetadata(
        wrapper,
        Array.from(code.classList)
          .find((name) => name.startsWith("language-"))
          ?.slice(9),
      )
      pre.replaceWith(wrapper)
      wrapper.appendChild(pre)
      wrapper.appendChild(createCopyButton(labels))
      decorateMermaid(wrapper, code, true)
    })
  }

  if (block.mode === "full") {
    next.querySelectorAll<HTMLElement>("pre > code.language-mermaid").forEach((code) => {
      const pre = code.parentElement!
      const wrapper = document.createElement("div")
      wrapper.setAttribute("data-component", "markdown-code")
      pre.replaceWith(wrapper)
      wrapper.appendChild(pre)
      decorateMermaid(wrapper, code, true)
    })
  }

  if (existing) return
  if (!current) {
    container.appendChild(next)
    return
  }
  disposeCopyButtons(current)
  disposeRenderedMarkdown(current)
  current.replaceWith(next)
}

function updateCodeBlock(
  container: HTMLDivElement,
  current: Element | undefined,
  block: Extract<RenderedBlock, { mode: "code" }>,
  labels: CopyLabels,
) {
  const existing =
    current instanceof HTMLDivElement && current.dataset.markdownKey === block.key && renderedCodeTokens.has(current)
      ? current
      : undefined
  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.dataset.markdownComplete = block.complete ? "true" : "false"
  next.style.display = "contents"

  const code = existing?.querySelector("code")
  if (code instanceof HTMLElement) {
    const wrapper = code.closest('[data-component="markdown-code"]')
    if (wrapper instanceof HTMLElement) applyCodeMetadata(wrapper, block.language)
    code.className = `language-${block.language}`
    const previous = renderedCodeTokens.get(next)
    const reset = shouldResetCodeTokens(previous, {
      language: block.language,
      generation: block.generation,
      stableCount: block.stable.length,
      raw: block.raw,
    })
    const stableCount = reset ? 0 : previous!.stableCount
    const tail = [...block.stable.slice(stableCount), ...block.unstable]
    const prior = reset ? [] : previous!.unstable
    const prefix = prior.findIndex((token, index) => !sameToken(token, tail[index]))
    const keep = stableCount + (prefix < 0 ? Math.min(prior.length, tail.length) : prefix)
    while (code.children.length > keep) code.lastElementChild?.remove()
    tail
      .slice(keep - stableCount)
      .map(createTokenSpan)
      .forEach((span) => code.appendChild(span))
    renderedCodeTokens.set(next, {
      language: block.language,
      generation: block.generation,
      stableCount: block.stable.length,
      unstable: block.unstable,
      raw: block.raw,
    })
    if (wrapper instanceof HTMLElement) decorateMermaid(wrapper, code, block.complete)
    return
  }

  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  applyCodeMetadata(wrapper, block.language)
  const pre = document.createElement("pre")
  pre.className = "shiki OpenCode"
  const codeElement = document.createElement("code")
  codeElement.className = `language-${block.language}`
  ;[...block.stable, ...block.unstable].map(createTokenSpan).forEach((span) => codeElement.appendChild(span))
  pre.appendChild(codeElement)
  wrapper.appendChild(pre)
  wrapper.appendChild(createCopyButton(labels))
  decorateMermaid(wrapper, codeElement, block.complete)
  next.appendChild(wrapper)
  renderedCodeTokens.set(next, {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    unstable: block.unstable,
    raw: block.raw,
  })
  if (current) {
    disposeCopyButtons(current)
    disposeRenderedMarkdown(current)
    current.replaceWith(next)
    return
  }
  container.appendChild(next)
}

function sameToken(left: MarkdownToken, right: MarkdownToken | undefined) {
  return !!right && left[0] === right[0] && left[1] === right[1]
}

function createTokenSpan(token: MarkdownToken) {
  const span = document.createElement("span")
  span.setAttribute("style", token[1])
  span.textContent = token[0]
  return span
}
