/**
 * File Activity Section Component
 *
 * Displays a collapsible section showing files with AI activity (Read or Edited/Created).
 * Feature: 003-file-activity-highlight
 */

import { For, Show, createMemo } from "solid-js"
import { useFileActivity } from "@/context/file-activity"
import { useLocal, type LocalFile } from "@/context/local"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { ACTIVITY_VISUAL_CONFIG, type FileActivityType } from "@/types/file-activity"

export interface FileActivitySectionProps {
  /** Section type - "referenced" shows read files, "changed" shows edited/created files */
  type: "referenced" | "changed"
  /** Currently selected file path */
  selectedPath?: string
  /** Callback when a file is clicked */
  onFileClick?: (file: LocalFile) => void
  /** Callback when a file is double-clicked (activated) */
  onFileActivate?: (file: LocalFile) => void
}

/**
 * Returns the filename from a path
 */
function getFileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

/**
 * Section showing files with specific activity types.
 */
export function FileActivitySection(props: FileActivitySectionProps) {
  const fileActivity = useFileActivity()
  const local = useLocal()

  // Get files based on section type
  const files = createMemo(() => {
    const allFiles = fileActivity.getAllPaths()

    if (props.type === "referenced") {
      // Only show files that are "read" (not edited or created)
      return allFiles.filter((path) => {
        const activity = fileActivity.get(path)
        return activity?.type === "read"
      })
    } else {
      // Show files that are "edited" or "created"
      return allFiles.filter((path) => {
        const activity = fileActivity.get(path)
        return activity?.type === "edited" || activity?.type === "created"
      })
    }
  })

  // Sort files by timestamp (most recent first)
  const sortedFiles = createMemo(() => {
    return [...files()].sort((a, b) => {
      const activityA = fileActivity.get(a)
      const activityB = fileActivity.get(b)
      return (activityB?.timestamp ?? 0) - (activityA?.timestamp ?? 0)
    })
  })

  const sectionTitle = () => props.type === "referenced" ? "Referenced" : "Changed"
  const sectionConfig = () => props.type === "referenced"
    ? ACTIVITY_VISUAL_CONFIG.read
    : ACTIVITY_VISUAL_CONFIG.edited

  // Create a pseudo LocalFile for rendering
  const createLocalFile = (path: string): LocalFile => {
    const name = getFileName(path)
    return {
      path,
      absolute: path,
      name,
      type: "file",
      ignored: false,
    }
  }

  return (
    <Show when={sortedFiles().length > 0}>
      <Collapsible variant="ghost" class="w-full" defaultOpen>
        <Collapsible.Trigger>
          <div class="py-1.5 px-2 w-full flex items-center gap-x-2 cursor-pointer hover:bg-surface-raised-base-hover rounded-md">
            <Collapsible.Arrow class="text-icon-base size-4" />
            <span
              class={`size-2 rounded-full shrink-0 ${sectionConfig().badgeBackground}`}
            />
            <span class="text-12-medium text-text-base flex-1 text-left">
              {sectionTitle()}
            </span>
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="flex flex-col">
            <For each={sortedFiles()}>
              {(path) => {
                const file = createLocalFile(path)
                const activity = () => fileActivity.get(path)
                const activityConfig = () => activity() ? ACTIVITY_VISUAL_CONFIG[activity()!.type] : undefined

                return (
                  <button
                    class="py-1 px-2 pl-8 w-full flex items-center gap-x-2 rounded-md cursor-pointer transition-all duration-150"
                    classList={{
                      "hover:bg-surface-raised-base-hover": props.selectedPath !== path,
                      "bg-surface-interactive-base border border-border-weak-selected": props.selectedPath === path,
                      [activityConfig()?.background ?? ""]: !!activity() && props.selectedPath !== path,
                    }}
                    onClick={() => props.onFileClick?.(file)}
                    onDblClick={() => props.onFileActivate?.(file)}
                  >
                    <FileIcon node={file} class="text-icon-base size-4 shrink-0" />
                    <span
                      class="text-13-regular whitespace-nowrap truncate flex-1 text-left"
                      classList={{
                        "text-text-base": props.selectedPath !== path,
                        "text-text-strong": props.selectedPath === path,
                      }}
                      title={path}
                    >
                      {file.name}
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}
