import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { bundledLanguages, codeToHtml, type BundledLanguage } from "shiki"
import { Icon } from "@cedric/ui/icon"
import { IconButton } from "@cedric/ui/icon-button"
import { ScrollView } from "@cedric/ui/scroll-view"
import { useFile } from "@/context/file"

interface CodeViewerProps {
  path?: string
  onSendToChat?: (path: string) => void
  onSendToMainChat?: (path: string) => void
}

const extensionLanguages: Record<string, BundledLanguage> = {
  astro: "astro",
  bash: "bash",
  c: "c",
  cc: "cpp",
  conf: "properties",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "csv",
  dockerfile: "dockerfile",
  env: "dotenv",
  fish: "fish",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "zsh",
}

const plainTextLanguage: BundledLanguage = "ini"

function fileName(path: string) {
  return path.split("/").pop() || path
}

function extension(path: string) {
  const name = fileName(path).toLowerCase()
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile"
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index + 1)
}

function languageFromPath(path: string): BundledLanguage {
  const language = extensionLanguages[extension(path)] ?? plainTextLanguage
  return language in bundledLanguages ? language : plainTextLanguage
}

function decorateHtml(input: { html: string; query: string; currentLine?: number }) {
  if (!input.html) return ""

  const template = document.createElement("template")
  template.innerHTML = input.html
  const query = input.query.trim().toLowerCase()

  template.content.querySelectorAll(".line").forEach((line, index) => {
    const number = index + 1
    line.setAttribute("data-code-line", String(number))
    line.classList.add("block", "min-h-[1.35rem]", "px-4")

    if (query && (line.textContent ?? "").toLowerCase().includes(query)) {
      line.classList.add("bg-icon-info-active/10")
    }
    if (input.currentLine === number) {
      line.classList.add("ring-1", "ring-inset", "ring-icon-info-active/40", "bg-icon-info-active/15")
    }

    const gutter = document.createElement("span")
    gutter.textContent = String(number)
    gutter.setAttribute("aria-hidden", "true")
    gutter.className = "select-none inline-block w-10 shrink-0 pr-4 text-right text-text-disabled"
    line.prepend(gutter)
  })

  return template.innerHTML
}

export function CodeViewer(props: CodeViewerProps) {
  const file = useFile()
  const [source, setSource] = createSignal("")
  const [highlighted, setHighlighted] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [wrap, setWrap] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [matchIndex, setMatchIndex] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  let request = 0
  let codeRef: HTMLDivElement | undefined
  let searchRef: HTMLInputElement | undefined

  const language = createMemo(() => languageFromPath(props.path ?? ""))
  const lines = createMemo(() => source().split("\n"))
  const matches = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) return []
    return lines().flatMap((line, index) => (line.toLowerCase().includes(query) ? [index + 1] : []))
  })
  const currentLine = createMemo(() => matches()[matchIndex()])
  const visibleHtml = createMemo(() =>
    decorateHtml({
      html: highlighted(),
      query: search(),
      currentLine: currentLine(),
    }),
  )

  createEffect(() => {
    const path = props.path
    const current = ++request
    setCopied(false)
    setSearch("")
    setMatchIndex(0)

    if (!path) {
      setSource("")
      setHighlighted("")
      setError("")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    void file
      .load(path)
      .then(async () => {
        if (current !== request) return
        const state = file.get(path)
        const content = state?.content?.content ?? ""
        setSource(content)

        if (state?.error) {
          setError(state.error)
          setHighlighted("")
          return
        }

        const html = await codeToHtml(content, {
          lang: language(),
          theme: "github-dark",
          tabindex: false,
        })
        if (current !== request) return
        setHighlighted(html)
      })
      .catch((err) => {
        if (current !== request) return
        setError(err instanceof Error ? err.message : "Could not load file")
        setHighlighted("")
      })
      .finally(() => {
        if (current === request) setLoading(false)
      })
  })

  createEffect(() => {
    visibleHtml()
    const line = currentLine()
    if (!line) return
    queueMicrotask(() => {
      codeRef?.querySelector(`[data-code-line="${line}"]`)?.scrollIntoView({ block: "center" })
    })
  })

  const copy = () => {
    const text = source()
    if (!text) return
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  const nextMatch = () => {
    const total = matches().length
    if (!total) return
    setMatchIndex((matchIndex() + 1) % total)
  }

  const previousMatch = () => {
    const total = matches().length
    if (!total) return
    setMatchIndex((matchIndex() - 1 + total) % total)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault()
      searchRef?.focus()
      searchRef?.select()
      return
    }
    if (event.key === "Enter" && document.activeElement === searchRef) {
      event.preventDefault()
      if (event.shiftKey) previousMatch()
      else nextMatch()
    }
  }

  const sendToChat = () => {
    if (!props.path) return
    props.onSendToChat?.(props.path)
  }

  const sendToMainChat = () => {
    if (!props.path) return
    props.onSendToMainChat?.(props.path)
  }

  return (
    <div class="flex flex-col h-full bg-background-base" onKeyDown={handleKeyDown}>
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border-weaker-base shrink-0 min-w-0">
        <Icon name="code" class="w-4 h-4 text-syntax-function shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-text-base truncate">{props.path ? fileName(props.path) : "Code"}</div>
          <Show when={props.path}>
            <div class="text-11-regular text-text-disabled truncate">{props.path}</div>
          </Show>
        </div>

        <div class="hidden lg:flex items-center gap-1.5 shrink-0">
          <div class="flex items-center gap-1 px-2 py-1 rounded-md bg-background-stronger">
            <Icon name="magnifying-glass" class="w-3.5 h-3.5 text-text-weak" />
            <input
              ref={searchRef}
              value={search()}
              placeholder="Find"
              class="w-28 bg-transparent border-0 outline-none text-12-regular text-text-base placeholder:text-text-disabled"
              onInput={(event) => {
                setSearch(event.currentTarget.value)
                setMatchIndex(0)
              }}
            />
            <Show when={search()}>
              <span class="text-11-regular text-text-disabled tabular-nums">
                {matches().length ? `${matchIndex() + 1}/${matches().length}` : "0/0"}
              </span>
            </Show>
          </div>
          <IconButton icon="arrow-up" variant="ghost" class="w-7 h-7" title="Previous match" onClick={previousMatch} />
          <IconButton icon="arrow-down-to-line" variant="ghost" class="w-7 h-7" title="Next match" onClick={nextMatch} />
        </div>

        <button
          class="px-2 py-1 rounded-md text-12-regular text-text-weak hover:text-text-base hover:bg-background-stronger"
          onClick={() => setWrap(!wrap())}
        >
          {wrap() ? "No wrap" : "Wrap"}
        </button>
        <IconButton
          icon="comment"
          variant="ghost"
          class="w-7 h-7"
          title="Send file to Side Chat"
          aria-label="Send file to Side Chat"
          disabled={!props.path}
          onClick={sendToChat}
        />
        <IconButton
          icon="prompt"
          variant="ghost"
          class="w-7 h-7"
          title="Send file to Main Chat"
          aria-label="Send file to Main Chat"
          disabled={!props.path}
          onClick={sendToMainChat}
        />
        <IconButton icon={copied() ? "check" : "copy"} variant="ghost" class="w-7 h-7" title="Copy file" onClick={copy} />
      </div>

      <Show
        when={props.path}
        fallback={
          <div class="flex-1 flex items-center justify-center p-6 text-center">
            <div class="max-w-sm space-y-2">
              <div class="text-18-semibold text-text-base">No File Selected</div>
              <div class="text-14-regular text-text-weak">Open a source file to inspect it in Cedric.</div>
            </div>
          </div>
        }
      >
        <Show
          when={!loading() && !error()}
          fallback={
            <div class="flex-1 flex items-center justify-center p-6 text-center">
              <div class="max-w-sm space-y-2">
                <div class="text-18-semibold text-text-base">{loading() ? "Loading File" : "Could Not Load File"}</div>
                <div class="text-14-regular text-text-weak">{loading() ? props.path : error()}</div>
              </div>
            </div>
          }
        >
          <ScrollView class="flex-1">
            <div
              ref={codeRef}
              class="min-w-full text-13-regular leading-[1.35rem] [&_pre]:!bg-transparent [&_pre]:m-0 [&_pre]:py-4 [&_code]:block"
              classList={{
                "[&_.line]:whitespace-pre-wrap [&_.line]:break-words": wrap(),
                "[&_.line]:whitespace-pre": !wrap(),
              }}
              innerHTML={visibleHtml()}
            />
          </ScrollView>
        </Show>
      </Show>

      <Show when={!loading() && !error() && props.path}>
        <div class="flex items-center gap-3 px-3 py-1.5 border-t border-border-weaker-base text-11-regular text-text-disabled shrink-0">
          <span>{language()}</span>
          <span>{lines().length} lines</span>
          <Show when={search() && matches().length === 0}>
            <span>No matches</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
