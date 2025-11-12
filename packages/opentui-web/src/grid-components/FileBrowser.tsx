import type { Component } from "solid-js"
import { createSignal, For, Show } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"

export interface FileTreeNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileTreeNode[]
  size?: number
  modified?: number
}

interface FileBrowserProps {
  col?: number
  width?: number
  files: FileTreeNode[]
  onSelectFile?: (path: string) => void
  onClose?: () => void
}

export const FileBrowser: Component<FileBrowserProps> = (props) => {
  const startCol = () => props.col ?? 0
  const panelWidth = () => props.width ?? 40

  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)

  const toggleDir = (path: string) => {
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

  const handleSelect = (node: FileTreeNode) => {
    if (node.type === "directory") {
      toggleDir(node.path)
    } else {
      setSelectedPath(node.path)
      props.onSelectFile?.(node.path)
    }
  }

  const renderTree = (nodes: FileTreeNode[], depth = 0, startRow = 0): { elements: any[]; nextRow: number } => {
    const elements: any[] = []
    let currentRow = startRow

    nodes.forEach((node) => {
      const indent = 2 + depth * 2
      const isExpanded = expandedDirs().has(node.path)
      const isSelected = selectedPath() === node.path

      // Directory or file icon
      let icon = ""
      let iconColor = "#858585"

      if (node.type === "directory") {
        icon = isExpanded ? "▼" : "▶"
        iconColor = "#61afef"
      } else {
        // File icons based on extension
        const ext = node.name.split(".").pop()?.toLowerCase()
        switch (ext) {
          case "ts":
          case "tsx":
            icon = "⬢"
            iconColor = "#61afef"
            break
          case "js":
          case "jsx":
            icon = "⬢"
            iconColor = "#e5c07b"
            break
          case "json":
            icon = "{}"
            iconColor = "#98c379"
            break
          case "md":
            icon = "📄"
            iconColor = "#d4d4d4"
            break
          case "css":
            icon = "#"
            iconColor = "#61afef"
            break
          default:
            icon = "○"
            iconColor = "#858585"
        }
      }

      const nameColor = isSelected ? "#ffffff" : node.type === "directory" ? "#61afef" : "#d4d4d4"
      const bgColor = isSelected ? "#2a2a2a" : undefined

      elements.push(
        <GridText
          col={indent}
          row={currentRow}
          text={icon}
          fg={iconColor}
          bg={bgColor}
          onClick={() => handleSelect(node)}
        />,
      )

      elements.push(
        <GridText
          col={indent + 2}
          row={currentRow}
          text={node.name}
          fg={nameColor}
          bg={bgColor}
          onClick={() => handleSelect(node)}
        />,
      )

      currentRow++

      // Render children if directory is expanded
      if (node.type === "directory" && isExpanded && node.children) {
        const result = renderTree(node.children, depth + 1, currentRow)
        elements.push(...result.elements)
        currentRow = result.nextRow
      }
    })

    return { elements, nextRow: currentRow }
  }

  return (
    <GridPanel col={startCol()} row={0} width={panelWidth()} height="100%" bg="#0a0a0a" scrollable={true}>
      {/* Header */}
      <GridText col={2} row={1} text="FILE BROWSER" fg="#858585" bold />
      {props.onClose && <GridText col={panelWidth() - 2} row={1} text="✕" fg="#858585" onClick={props.onClose} />}

      {/* File tree */}
      <Show when={props.files.length > 0} fallback={<GridText col={2} row={3} text="No files" fg="#6a6a6a" />}>
        {(() => {
          const { elements } = renderTree(props.files, 0, 3)
          return <>{elements}</>
        })()}
      </Show>
    </GridPanel>
  )
}
