import { useI18n } from "@opencode/ui/context/i18n"
import { abort } from "@opencode/util/abort"
import { checksum } from "@opencode/util/encode"
import {
  type ComponentProps,
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  type Setter,
  splitProps,
} from "solid-js"
import { isServer, render } from "solid-js/web"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
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
import {
  useMarkdown,
  type MarkdownCodeBlock,
  type MarkdownCodeBlockMatch,
  type MarkdownCodeBlocks,
  type OpenMarkdownLocalFile,
  type ReadMarkdownImage,
  type MarkdownLocalFileExists,
} from "../context/markdown"
import { createMarkdownImages } from "./markdown-image"
import { createImagePreview } from "./image-preview"
import { setupFragmentLinks } from "./markdown-fragment-links"
import { markSessionLinks, setupSessionLinks } from "./markdown-session-links"
import { markdownClipboardHtml } from "./markdown-clipboard"

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

type InlineCodeCheck = { pending?: Promise<void> }

const inlineCodeChecks = new WeakMap<HTMLDivElement, InlineCodeCheck>()

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

    const fallbackToken: MarkdownToken = [text, ""]

    return { language: language ?? "text", generation: 0, stable: [], unstable: [fallbackToken] }
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
  // SAFETY: `render` runs its function synchronously, so both setters are assigned before this line.
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

// The Solid roots a code block holds besides its Copy button: plugin content and action buttons.
const codeHostDisposers = new WeakMap<HTMLElement, () => void>()

const codeHostSelector =
  '[data-slot="markdown-copy-button"], [data-slot="markdown-code-actions"], [data-slot="markdown-code-content"]'

function disposeCodeHost(host: HTMLElement) {
  copyButtonState.get(host)?.dispose()
  copyButtonState.delete(host)
  codeHostDisposers.get(host)?.()
  codeHostDisposers.delete(host)
}

function disposeCodeHosts(root: Element) {
  const hosts = [
    ...(root instanceof HTMLElement && root.matches(codeHostSelector) ? [root] : []),
    ...Array.from(root.querySelectorAll(codeHostSelector)).filter((el): el is HTMLElement => el instanceof HTMLElement),
  ]

  hosts.forEach(disposeCodeHost)
}

function disposeRenderedMarkdown(root: Element) {
  const blocks = [
    ...(root instanceof HTMLDivElement && root.hasAttribute("data-markdown-block") ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLDivElement>("[data-markdown-block]")),
  ]

  blocks.forEach((block) => {
    renderedMarkdown.get(block)?.renderer.dispose()
    renderedMarkdown.delete(block)
    inlineCodeChecks.delete(block)
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

type CodePlugins = { blocks: MarkdownCodeBlocks; match: MarkdownCodeBlockMatch }

type CodeMount = { match: MarkdownCodeBlockMatch; source: string; content?: HTMLElement }

const codeMounts = new WeakMap<HTMLElement, CodeMount>()

// Content for a block's language replaces its code only once the closing fence arrived, so it never receives half a
// block; until then, and when the content declines or fails, the block shows its code (or the built-in diagram).
// Blocks of other languages take the plain path.
function decorateCode(wrapper: HTMLElement, code: HTMLElement, complete: boolean, plugins: CodePlugins | undefined) {
  const previous = codeMounts.get(wrapper)

  if (!plugins && !previous) return decorateMermaid(wrapper, code, complete)

  const language = codeLanguage(wrapper.dataset.language)
  const claimed = !!plugins?.match.render.has(language)
  const acted = complete && !!plugins?.match.actions.has(language)

  if (!previous && !acted && !(claimed && complete))
    return claimed ? clearMermaid(wrapper) : decorateMermaid(wrapper, code, complete)

  const source = (code.textContent ?? "").replace(/\n$/, "")

  if (previous?.match === plugins?.match && previous?.source === source) return

  if (previous) clearCodeMount(wrapper, previous)

  if (!plugins || (!claimed && !acted)) return decorateMermaid(wrapper, code, complete)

  if (!complete) return clearMermaid(wrapper)

  const block = { code: source, language }
  const mount: CodeMount = { match: plugins.match, source }
  codeMounts.set(wrapper, mount)

  if (acted)
    wrapper.insertBefore(
      createCodeActions(plugins.blocks, block),
      wrapper.querySelector(':scope > [data-slot="markdown-copy-button"]'),
    )

  if (!claimed) return decorateMermaid(wrapper, code, complete)

  clearMermaid(wrapper)
  const content = document.createElement("div")
  content.dataset.slot = "markdown-code-content"
  mount.content = content
  wrapper.dataset.codeContent = ""
  wrapper.appendChild(content)

  const dispose = plugins.blocks.render(content, block, () => {
    if (mount.content === content) showCode(wrapper, code, mount)
  })

  // The content already failed while it rendered.
  if (mount.content !== content) return dispose?.()

  if (!dispose) return showCode(wrapper, code, mount)

  codeHostDisposers.set(content, dispose)
}

// Matches the language the worker's parser puts in a block's class, so streamed and completed blocks agree.
function codeLanguage(language: string | undefined) {
  return (language ?? "").toLowerCase().replace(/[^\w#+.-]/g, "")
}

function showCode(wrapper: HTMLElement, code: HTMLElement, mount: CodeMount) {
  const content = mount.content
  mount.content = undefined
  delete wrapper.dataset.codeContent

  if (content) {
    disposeCodeHost(content)
    content.remove()
  }

  decorateMermaid(wrapper, code, true)
}

function clearCodeMount(wrapper: HTMLElement, mount: CodeMount) {
  codeMounts.delete(wrapper)
  mount.content = undefined
  delete wrapper.dataset.codeContent
  wrapper
    .querySelectorAll<HTMLElement>(
      ':scope > [data-slot="markdown-code-actions"], :scope > [data-slot="markdown-code-content"]',
    )
    .forEach((host) => {
      disposeCodeHost(host)
      host.remove()
    })
}

function createCodeActions(blocks: MarkdownCodeBlocks, block: MarkdownCodeBlock) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-code-actions")

  codeHostDisposers.set(
    host,
    render(
      () => (
        <For each={blocks.actions(block.language)}>
          {(action) => (
            <Tooltip placement="top" value={action.title}>
              <IconButton
                type="button"
                size="normal"
                variant="ghost-muted"
                aria-label={action.title}
                icon={<Icon name={action.icon} />}
                onClick={() => action.run(block)}
              />
            </Tooltip>
          )}
        </For>
      ),
      host,
    ),
  )

  return host
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))

  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")

    const parentLink =
      code.parentElement instanceof HTMLAnchorElement &&
      code.parentElement.classList.contains("external-link") &&
      !code.parentElement.hasAttribute("data-local-link")
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

// Tables scroll inside a rounded frame.
function wrapTables(root: HTMLDivElement) {
  root.querySelectorAll("table").forEach((table) => {
    const wrapper = document.createElement("div")
    wrapper.dataset.component = "markdown-table"
    table.replaceWith(wrapper)
    wrapper.appendChild(table)
  })
}

const publicFaviconHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const privateFaviconSuffix = /\.(?:alt|example|internal|invalid|local|localhost|onion|test|ts\.net)$/

function markExternalLinkFavicons(root: HTMLDivElement) {
  root.querySelectorAll<HTMLAnchorElement>("a.external-link[href]").forEach((link) => {
    if (!link.textContent?.trim() || link.querySelector("img")) return

    if (!URL.canParse(link.href)) return
    const url = new URL(link.href)

    if (url.protocol !== "http:" && url.protocol !== "https:") return

    const favicon = document.createElement("span")
    favicon.className = "markdown-link-favicon"
    favicon.setAttribute("aria-hidden", "true")
    const host = url.hostname.toLowerCase()
    const glyph = document.createElement("span")
    glyph.className = "markdown-link-favicon-glyph"
    favicon.appendChild(glyph)

    if (host === "github.com") favicon.dataset.github = ""
    else if (
      publicFaviconHost.test(host) &&
      !privateFaviconSuffix.test(host) &&
      host !== "home.arpa" &&
      !host.endsWith(".home.arpa")
    ) {
      const image = document.createElement("img")
      image.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.host)}&sz=32`
      image.alt = ""
      image.setAttribute("data-markdown-favicon", "")
      image.width = 14
      image.height = 14
      image.decoding = "async"
      favicon.appendChild(image)
    }

    link.insertBefore(favicon, link.firstChild)
  })
}

// The globe stands in only until the favicon loads; removing it keeps transparent favicons from showing it through.
function showFavicon(image: HTMLImageElement) {
  image.dataset.loaded = ""
  image.parentElement?.querySelector(".markdown-link-favicon-glyph")?.remove()
}

function setupExternalLinkFavicons(root: HTMLDivElement) {
  const loaded = (event: Event) => {
    const image = event.target

    if (!(image instanceof HTMLImageElement) || !image.hasAttribute("data-markdown-favicon")) return

    if (image.naturalWidth > 0) showFavicon(image)
  }

  root.addEventListener("load", loaded, true)

  return () => root.removeEventListener("load", loaded, true)
}

// A path becomes a link once `localFileExists` says the file exists. A streaming block skips the check: its last code
// span may still be half written, and the block renders again once it completes.
function markInlineCode(
  source: HTMLDivElement,
  target: HTMLDivElement,
  live: boolean,
  signal: AbortSignal,
  localFileExists?: MarkdownLocalFileExists,
) {
  const check: InlineCodeCheck = {}
  inlineCodeChecks.set(target, check)
  const checked = new Map<string, boolean | Promise<boolean>>()
  const pending: Promise<void>[] = []

  for (const code of source.querySelectorAll<HTMLElement>(":not(pre) > code")) {
    delete code.dataset.inlineCodeKind
    const text = (code.textContent ?? "").trim()
    const kind = inlineCodeKind(text)

    if (kind === "url") code.dataset.inlineCodeKind = kind

    // Code inside a link already goes where the link does.
    if (kind !== "path" || live || !localFileExists || code.closest("a")) continue

    const previous = checked.get(text)

    if (previous !== undefined) {
      if (previous === true) code.dataset.inlineCodeKind = "path"

      continue
    }

    const exists = localFileExists(text)
    checked.set(text, exists)

    // Decorate the source before it is inserted or copied into a live Markdown renderer.
    if (exists === true || exists === false) {
      if (exists) code.dataset.inlineCodeKind = "path"

      continue
    }

    pending.push(
      exists
        .then((exists) => {
          if (!exists || signal.aborted || inlineCodeChecks.get(target) !== check) return
          target.querySelectorAll<HTMLElement>(":not(pre) > code").forEach((node) => {
            if (!node.closest("a") && (node.textContent ?? "").trim() === text) node.dataset.inlineCodeKind = "path"
          })
        })
        .catch(() => undefined),
    )
  }

  if (pending.length === 0) return

  check.pending = Promise.all(pending).then(() => {
    if (inlineCodeChecks.get(target) === check) inlineCodeChecks.delete(target)
  })

  return check.pending
}

function localLinkTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return
  const link = target.closest("a[data-local-link]")

  if (link instanceof HTMLElement) return link.dataset.localLink
  // Bare inline paths such as `src/app.ts` open like links when the host can resolve them.
  const code = target.closest(':not(pre) > code[data-inline-code-kind="path"]')

  if (code instanceof HTMLElement && !code.closest("a")) return code.textContent?.trim() || undefined
}

function setupLocalLinks(root: HTMLDivElement, open: () => OpenMarkdownLocalFile | undefined) {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const path = localLinkTarget(event.target)

    if (!path) return
    const handler = open()

    if (!handler) return
    event.preventDefault()
    handler(path)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.defaultPrevented) return

    if (!(event.target instanceof HTMLElement) || !event.target.matches("a[data-local-link]")) return
    const path = event.target.dataset.localLink
    const handler = open()

    if (!path || !handler) return
    event.preventDefault()
    handler(path)
  }

  root.addEventListener("click", handleClick)
  root.addEventListener("keydown", handleKeyDown)

  return () => {
    root.removeEventListener("click", handleClick)
    root.removeEventListener("keydown", handleKeyDown)
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

    disposeCodeHosts(root)
  }
}

// Selections that leave this message keep the browser's copy, since surrounding UI may hold hidden content.
function copySelection(event: ClipboardEvent & { currentTarget: HTMLDivElement }) {
  const selection = window.getSelection()

  if (event.defaultPrevented || !event.clipboardData || !selection || selection.isCollapsed) return
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))

  if (!ranges.every((range) => event.currentTarget.contains(range.commonAncestorContainer))) return
  event.preventDefault()
  event.clipboardData.setData("text/plain", selection.toString())
  event.clipboardData.setData(
    "text/html",
    `<meta charset="utf-8">${ranges.map((range) => markdownClipboardHtml(event.currentTarget, range)).join("")}`,
  )
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
  const previewImages = createImagePreview()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const owner = createUniqueId()
  const lifetime = new AbortController()
  const activeCodeKeys = new Set<string>()
  const completedCode = new Map<string, Extract<RenderedBlock, { mode: "code" }>>()
  const settledMarkdown = new Map<string, Exclude<RenderedBlock, { mode: "code" }>>()
  let renderedBlocks: RenderedBlock[] = []
  let lastRender: { base: string | undefined; blocks: Block[]; rendered: RenderedBlock[] } | undefined
  let appliedLabels: CopyLabels | undefined
  // The code block languages the blocks were decorated for; false before the first run.
  let decoratedMatch: MarkdownCodeBlockMatch | undefined | false = false
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

      const base = src.key ?? (!streamed ? checksum(src.text) : undefined)

      const render = async (block: Block, index: number): Promise<RenderedBlock> => {
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

        if (block.mode === "full") {
          const settled = settledMarkdown.get(blockKey)

          if (settled && (settled.src ?? settled.raw) === block.src) {
            if (key) {
              const cached = getCachedMarkdown(key)

              if (cached) touchCachedMarkdown(key, cached)
            }

            return settled
          }
        }

        const ready = block.mode === "full" ? getReadyMarkdown(block, key) : undefined
        const entry = ready ?? (await renderCachedMarkdown(block, key, lifetime.signal))

        if (block.mode === "full") {
          const settled = {
            key: blockKey,
            mode: block.mode,
            ...entry,
          }

          settledMarkdown.set(blockKey, settled)

          return settled
        }

        return {
          key: blockKey,
          mode: block.mode,
          ...entry,
        }
      }

      // The worker keeps an unchanged block as the same object, so the block the last render made from it is reused.
      // Rendering every block of the answer again on each delta cost a promise and two key strings per block.
      const previous = lastRender?.base === base ? lastRender : undefined

      const queued = src.projection.blocks.map((block, index) =>
        previous?.blocks[index] === block ? previous.rendered[index]! : render(block, index),
      )

      return Promise.all(
        queued.flatMap((item, index) =>
          item instanceof Promise ? [item.then((block) => [index, block] as const)] : [],
        ),
      )
        .then((done) => {
          const resolved = new Map(done)
          const blocks = queued.map((item, index) => (item instanceof Promise ? resolved.get(index)! : item))
          lastRender = { base, blocks: src.projection.blocks, rendered: blocks }

          return { text: src.text, blocks, ready: true } satisfies RenderResult
        })
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
  let linkCleanup: (() => void) | undefined
  let faviconCleanup: (() => void) | undefined
  let sessionLinkCleanup: (() => void) | undefined
  let fragmentLinkCleanup: (() => void) | undefined
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
    const codeBlocks = markdown?.codeBlocks
    const match = codeBlocks?.current()

    const plugins =
      codeBlocks && match && (match.render.size > 0 || match.actions.size > 0)
        ? { blocks: codeBlocks, match }
        : undefined

    const redecorate = decoratedMatch !== false && decoratedMatch !== match
    decoratedMatch = match

    if (content.length === 0) {
      renderedBlocks = []
      disposeCodeHosts(container)
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
    const sessionLinks = markdown?.sessionTitle
    const localFileExists = markdown?.localFileExists

    const pending = content.flatMap((block, index) => {
      const current = container.children[index]

      const check =
        renderedBlocks[index] === block && current instanceof HTMLDivElement
          ? inlineCodeChecks.get(current)?.pending
          : updateBlock(container, index, block, labels, plugins, sessionLinks, lifetime.signal, localFileExists)

      return check ? [check] : []
    })

    renderedBlocks = content

    // Blocks kept from earlier runs follow a plugin that starts or stops handling their language.
    if (redecorate)
      container.querySelectorAll<HTMLElement>('[data-component="markdown-code"]').forEach((wrapper) => {
        const code = wrapper.querySelector<HTMLElement>(":scope > pre > code")

        if (code) decorateCode(wrapper, code, wrapper.parentElement?.dataset.markdownComplete !== "false", plugins)
      })

    if (sessionLinks) markSessionLinks(container, sessionLinks)

    while (container.children.length > content.length) {
      const child = container.lastElementChild

      if (!child) break
      disposeCodeHosts(child)
      disposeRenderedMarkdown(child)
      child.remove()
    }

    images?.update(container)
    previewImages(container)
    container.querySelectorAll<HTMLImageElement>("img[data-markdown-favicon]").forEach((image) => {
      if (image.complete && image.naturalWidth > 0) showFavicon(image)
    })

    // A button gets the labels of the run that creates it, so the others only need new ones when the language changes.
    // Relabelling every button on each streamed delta re-rendered each one's tooltip and icon button.
    if (appliedLabels?.copy !== labels.copy || appliedLabels?.copied !== labels.copied)
      container
        .querySelectorAll<HTMLElement>('[data-slot="markdown-copy-button"]')
        .forEach((button) => setCopyState(button, labels, button.dataset.copied === "true"))

    appliedLabels = labels

    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
      }))

    if (!linkCleanup) linkCleanup = setupLocalLinks(container, () => markdown?.openLocalFile)

    if (!sessionLinkCleanup) sessionLinkCleanup = setupSessionLinks(container, () => markdown?.openSession)

    if (!fragmentLinkCleanup) fragmentLinkCleanup = setupFragmentLinks(container)

    if (!faviconCleanup) faviconCleanup = setupExternalLinkFavicons(container)
    container.toggleAttribute("data-local-links", !!markdown?.openLocalFile)

    if (!result?.ready || result.text !== local.text) return

    if (local.streaming || pending.length === 0) {
      container.dataset.markdownReady = ""

      return
    }

    // Cold timelines already wait for Markdown readiness before measuring and revealing their content. Include
    // path classification so the first visible frame uses the final blue-link styling and padding.
    void Promise.all(pending).then(() => {
      if (lifetime.signal.aborted || renderedBlocks !== content || result.text !== local.text) return
      container.dataset.markdownReady = ""
    })
  })

  onCleanup(() => {
    abort(lifetime)
    images?.dispose()

    if (copyCleanup) copyCleanup()

    if (linkCleanup) linkCleanup()

    if (sessionLinkCleanup) sessionLinkCleanup()

    if (fragmentLinkCleanup) fragmentLinkCleanup()

    if (faviconCleanup) faviconCleanup()
    const container = root()

    if (container) disposeRenderedMarkdown(container)

    if (streamed) disposeMarkdownProjection(owner)
    activeCodeKeys.forEach(disposeCode)
    completedCode.clear()
    settledMarkdown.clear()
    renderedBlocks = []
  })

  return (
    <div
      data-component="markdown"
      data-streaming={local.streaming ? "" : undefined}
      dir="auto"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      onCopy={copySelection}
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

    const fallbackToken: MarkdownToken = [block.src, ""]

    return {
      key,
      mode: block.mode,
      raw: block.raw,
      hash: String(block.raw.length),
      language: block.language ?? "text",
      complete: !!block.complete,
      stable: [],
      generation: 0,
      unstable: [fallbackToken],
    }
  })
}

function disposeCode(key: string) {
  disposeStreamingCode(key)
}

function updateBlock(
  container: HTMLDivElement,
  index: number,
  block: RenderedBlock,
  labels: CopyLabels,
  plugins: CodePlugins | undefined,
  sessionLinks: ((id: string) => string | undefined) | undefined,
  signal: AbortSignal,
  localFileExists?: MarkdownLocalFileExists,
) {
  const current = container.children[index]

  if (block.mode === "code") {
    updateCodeBlock(container, current, block, labels, plugins)

    return
  }

  const existing =
    current instanceof HTMLDivElement && current.dataset.markdownKey === block.key && !renderedCodeTokens.has(current)
      ? current
      : undefined

  if (existing?.dataset.markdownHash === block.hash) {
    // A block that finishes streaming keeps its DOM and the user's selection; only its file paths get checked now.
    if (existing.dataset.markdownMode === "live" && block.mode !== "live") {
      existing.dataset.markdownMode = block.mode

      return markInlineCode(existing, existing, false, signal, localFileExists)
    }

    return inlineCodeChecks.get(existing)?.pending
  }

  const next = existing ?? document.createElement("div")
  next.dataset.markdownBlock = ""
  next.dataset.markdownKey = block.key
  next.dataset.markdownHash = block.hash
  next.dataset.markdownMode = block.mode
  next.style.display = "contents"
  const rendered = renderedMarkdown.get(next)
  // Keep live renderers in control of their DOM, including after completion.
  const source = rendered || block.mode === "live" ? document.createElement("div") : next

  if (source === next) disposeCodeHosts(next)
  source.innerHTML = block.html
  const pending = markInlineCode(source, next, block.mode === "live", signal, localFileExists)
  markCodeLinks(source)
  wrapTables(source)

  if (sessionLinks) markSessionLinks(source, sessionLinks)
  markExternalLinkFavicons(source)

  if (rendered) {
    rendered.renderer.update(source, block.mode === "live", rendered.raw !== block.raw)
    rendered.raw = block.raw

    return pending
  }

  if (block.mode === "live") {
    next.replaceChildren()
    renderedMarkdown.set(next, {
      renderer: createMarkdownRenderer(next, source, true),
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
      decorateCode(wrapper, code, true, plugins)
    })
  }

  if (existing) return pending

  if (!current) {
    container.appendChild(next)

    return pending
  }

  disposeCodeHosts(current)
  disposeRenderedMarkdown(current)
  current.replaceWith(next)

  return pending
}

function updateCodeBlock(
  container: HTMLDivElement,
  current: Element | undefined,
  block: Extract<RenderedBlock, { mode: "code" }>,
  labels: CopyLabels,
  plugins: CodePlugins | undefined,
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

    if (wrapper instanceof HTMLElement) decorateCode(wrapper, code, block.complete, plugins)

    return
  }

  const wrapper = document.createElement("div")
  wrapper.setAttribute("data-component", "markdown-code")
  applyCodeMetadata(wrapper, block.language)
  const pre = document.createElement("pre")
  pre.className = "highlights"
  const codeElement = document.createElement("code")
  codeElement.className = `language-${block.language}`
  ;[...block.stable, ...block.unstable].map(createTokenSpan).forEach((span) => codeElement.appendChild(span))
  pre.appendChild(codeElement)
  wrapper.appendChild(pre)
  wrapper.appendChild(createCopyButton(labels))
  decorateCode(wrapper, codeElement, block.complete, plugins)
  next.appendChild(wrapper)
  renderedCodeTokens.set(next, {
    language: block.language,
    generation: block.generation,
    stableCount: block.stable.length,
    unstable: block.unstable,
    raw: block.raw,
  })

  if (current) {
    disposeCodeHosts(current)
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
