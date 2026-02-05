import { createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Dialog } from "./dialog"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { Markdown } from "./markdown"
import { useI18n } from "../context/i18n"

// =============================================================================
// Types
// =============================================================================

export type ToolDetailType = "file" | "terminal" | "browser" | "generic"

export interface FileDetailProps {
  type: "file"
  filePath: string
  content: string
  lineOffset?: number
  language?: string
}

export interface TerminalDetailProps {
  type: "terminal"
  command: string
  output: string
  exitCode?: number | null
  workdir?: string
}

export interface BrowserDetailProps {
  type: "browser"
  url: string
  screenshot?: string // base64 data URL
  pageTitle?: string
}

export interface GenericDetailProps {
  type: "generic"
  title: string
  content: string
}

export type ToolDetailProps =
  | FileDetailProps
  | TerminalDetailProps
  | BrowserDetailProps
  | GenericDetailProps

export interface ToolDetailModalProps {
  detail: ToolDetailProps
}

// =============================================================================
// File Editor View
// =============================================================================

function FileEditorView(props: FileDetailProps) {
  const lines = () => props.content.split("\n")
  const startLine = () => props.lineOffset ?? 1
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase() ?? ""
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      h: "c",
      css: "css",
      scss: "scss",
      html: "html",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sh: "bash",
      bash: "bash",
      sql: "sql",
    }
    return props.language ?? langMap[ext] ?? "plaintext"
  }

  return (
    <div data-component="tool-detail-file">
      <div data-slot="file-header">
        <div data-slot="file-path">
          <Icon name="code-lines" size="small" />
          <span>{props.filePath}</span>
        </div>
        <IconButton
          icon={copied() ? "check" : "copy"}
          size="small"
          variant="ghost"
          onClick={handleCopy}
          aria-label={copied() ? "Copied" : "Copy"}
        />
      </div>
      <div data-slot="file-content">
        <div data-slot="line-numbers">
          <For each={lines()}>
            {(_, i) => <div data-slot="line-number">{startLine() + i()}</div>}
          </For>
        </div>
        <div data-slot="code-content">
          <Markdown
            text={`\`\`\`${getLanguageFromPath(props.filePath)}\n${props.content}\n\`\`\``}
          />
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Terminal View
// =============================================================================

function TerminalView(props: TerminalDetailProps) {
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const fullOutput = `$ ${props.command}\n${props.output}`
    await navigator.clipboard.writeText(fullOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const exitCodeClass = () => {
    if (props.exitCode === null || props.exitCode === undefined) return "pending"
    return props.exitCode === 0 ? "success" : "error"
  }

  return (
    <div data-component="tool-detail-terminal">
      <div data-slot="terminal-header">
        <div data-slot="terminal-title">
          <Icon name="console" size="small" />
          <span>Terminal</span>
          <Show when={props.workdir}>
            <span data-slot="terminal-workdir">{props.workdir}</span>
          </Show>
        </div>
        <div data-slot="terminal-actions">
          <Show when={props.exitCode !== null && props.exitCode !== undefined}>
            <span data-slot="exit-code" data-status={exitCodeClass()}>
              Exit: {props.exitCode}
            </span>
          </Show>
          <IconButton
            icon={copied() ? "check" : "copy"}
            size="small"
            variant="ghost"
            onClick={handleCopy}
            aria-label={copied() ? "Copied" : "Copy"}
          />
        </div>
      </div>
      <div data-slot="terminal-content">
        <div data-slot="terminal-command">
          <span data-slot="prompt">$</span>
          <span data-slot="command-text">{props.command}</span>
        </div>
        <Show when={props.output}>
          <div data-slot="terminal-output">
            <pre>{props.output}</pre>
          </div>
        </Show>
      </div>
    </div>
  )
}

// =============================================================================
// Browser View
// =============================================================================

function BrowserView(props: BrowserDetailProps) {
  const [imageLoaded, setImageLoaded] = createSignal(false)
  const [imageError, setImageError] = createSignal(false)

  const displayUrl = () => {
    try {
      const url = new URL(props.url)
      return url.hostname + url.pathname
    } catch {
      return props.url
    }
  }

  return (
    <div data-component="tool-detail-browser">
      <div data-slot="browser-chrome">
        <div data-slot="browser-controls">
          <div data-slot="traffic-light" data-color="red" />
          <div data-slot="traffic-light" data-color="yellow" />
          <div data-slot="traffic-light" data-color="green" />
        </div>
        <div data-slot="browser-url-bar">
          <Icon name="check-small" size="small" />
          <span data-slot="url-text">{displayUrl()}</span>
        </div>
        <div data-slot="browser-spacer" />
      </div>
      <div data-slot="browser-content">
        <Show
          when={props.screenshot}
          fallback={
            <div data-slot="browser-placeholder">
              <Icon name="window-cursor" size="large" />
              <span>No screenshot available</span>
            </div>
          }
        >
          <Show when={!imageLoaded() && !imageError()}>
            <div data-slot="browser-loading">Loading screenshot...</div>
          </Show>
          <Show when={imageError()}>
            <div data-slot="browser-error">Failed to load screenshot</div>
          </Show>
          <img
            src={props.screenshot}
            alt={props.pageTitle ?? "Browser screenshot"}
            data-slot="browser-screenshot"
            data-loaded={imageLoaded()}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </Show>
      </div>
      <Show when={props.pageTitle}>
        <div data-slot="browser-footer">
          <span>{props.pageTitle}</span>
        </div>
      </Show>
    </div>
  )
}

// =============================================================================
// Generic View
// =============================================================================

function GenericView(props: GenericDetailProps) {
  return (
    <div data-component="tool-detail-generic">
      <div data-slot="generic-header">
        <Icon name="mcp" size="small" />
        <span>{props.title}</span>
      </div>
      <div data-slot="generic-content">
        <Markdown text={props.content} />
      </div>
    </div>
  )
}

// =============================================================================
// Main Modal Component
// =============================================================================

export function ToolDetailModal(props: ToolDetailModalProps) {
  const i18n = useI18n()

  const getTitle = (): string => {
    switch (props.detail.type) {
      case "file":
        return props.detail.filePath.split("/").pop() ?? "File"
      case "terminal":
        return "Terminal Output"
      case "browser":
        return props.detail.pageTitle ?? "Browser"
      case "generic":
        return props.detail.title
    }
  }

  const getIcon = (): JSX.Element => {
    switch (props.detail.type) {
      case "file":
        return <Icon name="code-lines" size="small" />
      case "terminal":
        return <Icon name="console" size="small" />
      case "browser":
        return <Icon name="window-cursor" size="small" />
      case "generic":
        return <Icon name="mcp" size="small" />
    }
  }

  return (
    <Dialog title={getTitle()} size="x-large">
      <div data-component="tool-detail-modal">
        <Switch>
          <Match when={props.detail.type === "file" && props.detail}>
            {(detail) => <FileEditorView {...(detail() as FileDetailProps)} />}
          </Match>
          <Match when={props.detail.type === "terminal" && props.detail}>
            {(detail) => <TerminalView {...(detail() as TerminalDetailProps)} />}
          </Match>
          <Match when={props.detail.type === "browser" && props.detail}>
            {(detail) => <BrowserView {...(detail() as BrowserDetailProps)} />}
          </Match>
          <Match when={props.detail.type === "generic" && props.detail}>
            {(detail) => <GenericView {...(detail() as GenericDetailProps)} />}
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Utility: Parse line numbers from read tool output
// =============================================================================

export function parseReadOutput(output: string): { content: string; startLine: number } {
  const lines = output.split("\n")
  let content = ""
  let startLine = 1
  let foundFirstLine = false

  for (const line of lines) {
    // Match pattern: "00001| content" or "    1| content"
    const match = line.match(/^\s*(\d+)\|\s?(.*)$/)
    if (match) {
      if (!foundFirstLine) {
        startLine = parseInt(match[1], 10)
        foundFirstLine = true
      }
      content += (content ? "\n" : "") + match[2]
    }
  }

  return { content: content || output, startLine }
}

// =============================================================================
// Helper: Create ToolDetailProps from tool data
// =============================================================================

export function createFileDetail(filePath: string, content: string, lineOffset?: number): FileDetailProps {
  return {
    type: "file",
    filePath,
    content,
    lineOffset,
  }
}

export function createTerminalDetail(
  command: string,
  output: string,
  exitCode?: number | null,
  workdir?: string,
): TerminalDetailProps {
  return {
    type: "terminal",
    command,
    output,
    exitCode,
    workdir,
  }
}

export function createBrowserDetail(url: string, screenshot?: string, pageTitle?: string): BrowserDetailProps {
  return {
    type: "browser",
    url,
    screenshot,
    pageTitle,
  }
}

export function createGenericDetail(title: string, content: string): GenericDetailProps {
  return {
    type: "generic",
    title,
    content,
  }
}

// =============================================================================
// Exports
// =============================================================================

export { FileEditorView, TerminalView, BrowserView, GenericView }
