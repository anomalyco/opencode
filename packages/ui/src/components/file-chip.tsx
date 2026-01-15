/**
 * FileChip Component
 *
 * A friendly, clickable chip for displaying file references in AI responses.
 * Shows a file icon and filename, and opens the file preview on click.
 */

import { JSX, splitProps } from "solid-js"
import { FileIcon } from "./file-icon"

export interface FileChipProps {
  /** The filename to display */
  filename: string
  /** The full path (for opening preview) */
  path: string
  /** Click handler - typically opens file preview */
  onClick?: (path: string) => void
  /** Additional class names */
  class?: string
}

export function FileChip(props: FileChipProps) {
  const [local, others] = splitProps(props, ["filename", "path", "onClick", "class"])

  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    local.onClick?.(local.path)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      class={`
        inline-flex items-center gap-1.5
        px-2 py-0.5
        rounded-md
        bg-surface-base/80
        border border-border-base/60
        text-text-base text-12-medium
        hover:bg-surface-raised-base-hover hover:border-border-base
        active:bg-surface-raised-base-active
        transition-colors duration-150
        cursor-pointer
        max-w-[280px]
        align-middle
        ${local.class ?? ""}
      `}
      title={local.path}
      {...others}
    >
      <FileIcon
        node={{ path: local.filename, type: "file" }}
        class="w-4 h-4 shrink-0"
      />
      <span class="truncate">{local.filename}</span>
    </button>
  )
}

/**
 * Placeholder element used during markdown parsing.
 * This gets replaced with actual FileChip components after render.
 */
export function createFileChipPlaceholder(path: string, filename: string): string {
  // Use a data attribute to store the path and filename
  // This will be hydrated into a real component after markdown render
  return `<span data-file-chip data-path="${encodeURIComponent(path)}" data-filename="${encodeURIComponent(filename)}" class="file-chip-placeholder">${filename}</span>`
}
