import { createSignal, createEffect, Show, For, onMount, createMemo } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"

interface FileBrowserProps {
  directory?: string
  onSelectFile: (filePath: string) => void
  onClose: () => void
}

interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileNode[]
}

export function FileBrowser(props: FileBrowserProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const [files, setFiles] = createSignal<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set())
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  // Flatten tree for keyboard navigation
  const flattenedFiles = createMemo(() => {
    const result: { node: FileNode; depth: number }[] = []
    const traverse = (nodes: FileNode[], depth = 0) => {
      nodes.forEach((node) => {
        result.push({ node, depth })
        if (node.type === "directory" && expandedDirs().has(node.path) && node.children) {
          traverse(node.children, depth + 1)
        }
      })
    }
    traverse(files())
    return result
  })

  // Load files
  onMount(async () => {
    try {
      const result = await sdk.client.file.list({
        query: {
          directory: props.directory || ".",
          path: ".",
        },
      })

      if (result.data) {
        // Convert API response to FileNode tree
        const nodes = result.data.map((item: any) => ({
          name: item.name,
          path: item.path,
          type: item.type as "file" | "directory",
          children: item.type === "directory" ? [] : undefined,
        }))
        setFiles(nodes)
        setIsLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setIsLoading(false)
    }
  })

  // Keyboard navigation
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onClose()
      return
    }

    const maxIndex = flattenedFiles().length - 1

    if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((prev) => Math.min(prev + 1, maxIndex))
    } else if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (evt.name === "return") {
      const selected = flattenedFiles()[selectedIndex()]
      if (selected) {
        if (selected.node.type === "directory") {
          toggleDirectory(selected.node.path)
        } else {
          props.onSelectFile(selected.node.path)
        }
      }
    } else if (evt.name === "right" || evt.name === "l") {
      const selected = flattenedFiles()[selectedIndex()]
      if (selected?.node.type === "directory") {
        setExpandedDirs((prev) => new Set([...prev, selected.node.path]))
      }
    } else if (evt.name === "left" || evt.name === "h") {
      const selected = flattenedFiles()[selectedIndex()]
      if (selected?.node.type === "directory" && expandedDirs().has(selected.node.path)) {
        toggleDirectory(selected.node.path)
      }
    }
  })

  const toggleDirectory = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const getFileIcon = (node: FileNode) => {
    if (node.type === "directory") {
      return expandedDirs().has(node.path) ? "▼" : "▶"
    }

    const ext = node.name.split(".").pop()?.toLowerCase() || ""
    switch (ext) {
      case "ts":
      case "tsx":
        return "⬢"
      case "js":
      case "jsx":
        return "◆"
      case "json":
        return "{}"
      case "md":
        return "□"
      case "css":
        return "#"
      default:
        return "•"
    }
  }

  const getFileColor = (node: FileNode, isSelected: boolean) => {
    if (isSelected) return theme.text
    if (node.type === "directory") return theme.secondary

    const ext = node.name.split(".").pop()?.toLowerCase() || ""
    switch (ext) {
      case "ts":
      case "tsx":
        return theme.primary
      case "js":
      case "jsx":
        return theme.accent
      case "json":
        return theme.success
      default:
        return theme.textMuted
    }
  }

  // Calculate centered dialog dimensions
  const dialogWidth = Math.min(Math.floor(dimensions().width * 0.8), 120)
  const dialogHeight = Math.min(Math.floor(dimensions().height * 0.8), 40)
  const offsetX = Math.floor((dimensions().width - dialogWidth) / 2)
  const offsetY = Math.floor((dimensions().height - dialogHeight) / 2)

  return (
    <box width={dimensions().width} height={dimensions().height} flexDirection="column" backgroundColor="transparent">
      {/* Semi-transparent backdrop */}
      <box
        width={dimensions().width}
        height={dimensions().height}
        position="absolute"
        backgroundColor={theme.background}
        onMouseUp={() => props.onClose()}
      />

      {/* Centered dialog */}
      <box
        width={dialogWidth}
        height={dialogHeight}
        position="absolute"
        left={offsetX}
        top={offsetY}
        flexDirection="column"
        backgroundColor={theme.background}
        borderStyle="rounded"
        borderColor={theme.primary}
      >
        {/* Header */}
        <box height={1} backgroundColor={theme.backgroundPanel} flexDirection="row" justifyContent="space-between">
          <box paddingLeft={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              File Browser
            </text>
          </box>
          <box paddingRight={1}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              ESC to close
            </text>
          </box>
        </box>

        {/* Path */}
        <box height={1} backgroundColor={theme.backgroundElement} paddingLeft={1}>
          <text fg={theme.textMuted}>{props.directory || "."}</text>
        </box>

        {/* Content area */}
        <box flexGrow={1} flexDirection="column" backgroundColor={theme.background}>
          <Show when={isLoading()}>
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={theme.textMuted}>Loading files...</text>
            </box>
          </Show>

          <Show when={error()}>
            <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                Error Loading Files
              </text>
              <text fg={theme.textMuted}>{error()}</text>
            </box>
          </Show>

          <Show when={!isLoading() && !error()}>
            <box flexDirection="column" paddingLeft={1} paddingTop={1}>
              <For each={flattenedFiles()}>
                {(item, idx) => {
                  const isSelected = idx() === selectedIndex()
                  const indent = "  ".repeat(item.depth)

                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={isSelected ? theme.backgroundElement : undefined}
                      onMouseUp={() => {
                        setSelectedIndex(idx())
                        if (item.node.type === "directory") {
                          toggleDirectory(item.node.path)
                        } else {
                          props.onSelectFile(item.node.path)
                        }
                      }}
                    >
                      <text>{indent}</text>
                      <text fg={getFileColor(item.node, isSelected)} flexShrink={0}>
                        {getFileIcon(item.node)}
                      </text>
                      <text
                        fg={getFileColor(item.node, isSelected)}
                        attributes={isSelected ? TextAttributes.BOLD : undefined}
                      >
                        {item.node.name}
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>

        {/* Footer */}
        <box height={2} backgroundColor={theme.backgroundPanel} flexDirection="column">
          <box height={1} paddingLeft={1}>
            <text fg={theme.textMuted}>{flattenedFiles().length} items</text>
          </box>
          <box height={1} paddingLeft={1} flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>↑↓ navigate</text>
            <text fg={theme.textMuted}>←→ collapse/expand</text>
            <text fg={theme.textMuted}>Enter open</text>
            <text fg={theme.textMuted}>ESC close</text>
          </box>
        </box>
      </box>
    </box>
  )
}
