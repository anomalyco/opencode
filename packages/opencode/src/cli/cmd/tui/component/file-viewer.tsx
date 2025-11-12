import { createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"

interface FileViewerProps {
  filePath: string
  onClose: () => void
}

export function FileViewer(props: FileViewerProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const [content, setContent] = createSignal<string>("")
  const [lines, setLines] = createSignal<string[]>([])
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  // Determine language from file extension
  const getLanguage = () => {
    const ext = props.filePath.split(".").pop()?.toLowerCase() || ""
    const langMap: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript React",
      js: "JavaScript",
      jsx: "JavaScript React",
      json: "JSON",
      md: "Markdown",
      css: "CSS",
      html: "HTML",
      py: "Python",
      go: "Go",
      rs: "Rust",
      java: "Java",
      sh: "Shell",
      yaml: "YAML",
      yml: "YAML",
    }
    return langMap[ext] || "Text"
  }

  // Load file content
  onMount(async () => {
    try {
      const result = await sdk.client.file.read({ query: { path: props.filePath } })
      if (result.data && result.data.type === "text") {
        setContent(result.data.content)
        setLines(result.data.content.split("\n"))
        setIsLoading(false)
      } else {
        setError("Unable to read file content")
        setIsLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file")
      setIsLoading(false)
    }
  })

  // Keyboard navigation
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onClose()
      return
    }

    const maxScroll = Math.max(0, lines().length - (dimensions().height - 6))

    if (evt.name === "down" || evt.name === "j") {
      setScrollOffset((prev) => Math.min(prev + 1, maxScroll))
    } else if (evt.name === "up" || evt.name === "k") {
      setScrollOffset((prev) => Math.max(prev - 1, 0))
    } else if (evt.name === "pagedown" || (evt.ctrl && evt.name === "f")) {
      setScrollOffset((prev) => Math.min(prev + (dimensions().height - 6), maxScroll))
    } else if (evt.name === "pageup" || (evt.ctrl && evt.name === "b")) {
      setScrollOffset((prev) => Math.max(prev - (dimensions().height - 6), 0))
    } else if (evt.name === "home" || evt.name === "g") {
      setScrollOffset(0)
    } else if (evt.name === "end" || evt.name === "G") {
      setScrollOffset(maxScroll)
    }
  })

  // Scroll with mouse wheel
  const handleMouseWheel = (delta: number) => {
    const maxScroll = Math.max(0, lines().length - (dimensions().height - 6))
    if (delta > 0) {
      setScrollOffset((prev) => Math.min(prev + 3, maxScroll))
    } else {
      setScrollOffset((prev) => Math.max(prev - 3, 0))
    }
  }

  // Get visible lines
  const visibleLines = () => {
    const start = scrollOffset()
    const end = start + (dimensions().height - 6)
    return lines()
      .slice(start, end)
      .map((line, idx) => ({
        lineNumber: start + idx + 1,
        content: line,
      }))
  }

  // Syntax highlighting helper (basic - can be enhanced)
  const getLineColor = (line: string, lang: string) => {
    // Keywords
    if (
      lang.includes("JavaScript") ||
      lang.includes("TypeScript") ||
      lang === "Go" ||
      lang === "Rust" ||
      lang === "Python"
    ) {
      if (/^\s*(const|let|var|function|class|if|else|for|while|return|import|export|from|async|await)\s/.test(line)) {
        return theme.primary
      }
      if (/^\s*(\/\/|#)/.test(line)) {
        return theme.textMuted
      }
      if (/"[^"]*"|'[^']*'|`[^`]*`/.test(line)) {
        return theme.success
      }
    }
    return theme.text
  }

  const fileName = () => props.filePath.split("/").pop() || props.filePath
  const maxScroll = () => Math.max(0, lines().length - (dimensions().height - 6))
  const scrollPercentage = () => {
    if (maxScroll() === 0) return 100
    return Math.round((scrollOffset() / maxScroll()) * 100)
  }

  // Centered dialog calculations
  const dialogWidth = () => Math.min(Math.floor(dimensions().width * 0.8), 120)
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.8), 40)
  const dialogX = () => Math.floor((dimensions().width - dialogWidth()) / 2)
  const dialogY = () => Math.floor((dimensions().height - dialogHeight()) / 2)

  return (
    <box width={dimensions().width} height={dimensions().height}>
      {/* Backdrop */}
      <box
        position="absolute"
        top={0}
        left={0}
        width={dimensions().width}
        height={dimensions().height}
        backgroundColor={theme.background}
      />

      {/* Centered Dialog */}
      <box
        position="absolute"
        top={dialogY()}
        left={dialogX()}
        width={dialogWidth()}
        height={dialogHeight()}
        flexDirection="column"
        backgroundColor={theme.background}
        borderStyle="rounded"
        borderColor={theme.border}
      >
        {/* Header */}
        <box height={1} backgroundColor={theme.backgroundPanel} flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {fileName()}
            </text>
            <text fg={theme.textMuted}>({getLanguage()})</text>
          </box>
          <box flexDirection="row" gap={2} paddingRight={1}>
            <text fg={theme.textMuted}>{lines().length} lines</text>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              ESC to close
            </text>
          </box>
        </box>

        {/* File path */}
        <box height={1} backgroundColor={theme.backgroundElement} paddingLeft={1}>
          <text fg={theme.textMuted}>{props.filePath}</text>
        </box>

        {/* Content area */}
        <box flexGrow={1} flexDirection="column" backgroundColor={theme.background}>
          <Show when={isLoading()}>
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={theme.textMuted}>Loading file...</text>
            </box>
          </Show>

          <Show when={error()}>
            <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                Error Loading File
              </text>
              <text fg={theme.textMuted}>{error()}</text>
            </box>
          </Show>

          <Show when={!isLoading() && !error()}>
            <box flexDirection="column" paddingLeft={1}>
              <For each={visibleLines()}>
                {(line) => {
                  const lineNumWidth = String(lines().length).length
                  const lineNum = String(line.lineNumber).padStart(lineNumWidth, " ")
                  return (
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted} flexShrink={0}>
                        {lineNum}
                      </text>
                      <text fg={getLineColor(line.content, getLanguage())} wrapMode="none">
                        {line.content || " "}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>

        {/* Footer - status bar */}
        <box height={2} backgroundColor={theme.backgroundPanel} flexDirection="column">
          <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>
              Lines {scrollOffset() + 1}-{Math.min(scrollOffset() + (dimensions().height - 6), lines().length)} of{" "}
              {lines().length}
            </text>
            <text fg={theme.textMuted}>{scrollPercentage()}%</text>
          </box>
          <box height={1} paddingLeft={1} flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>↑↓ scroll</text>
            <text fg={theme.textMuted}>PgUp/PgDn jump</text>
            <text fg={theme.textMuted}>Home/End top/bottom</text>
            <text fg={theme.textMuted}>g/G top/bottom</text>
          </box>
        </box>
      </box>
    </box>
  )
}
