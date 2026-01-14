import { useLocal, type LocalFile } from "@/context/local"
import { useFileActivity } from "@/context/file-activity"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMemo, For, Match, Switch, type ComponentProps, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import { ACTIVITY_VISUAL_CONFIG } from "@/types/file-activity"

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  level?: number
  selectedPath?: string
  workspacePath?: string
  showHidden?: boolean
  hideActivityFiles?: boolean
  onFileClick?: (file: LocalFile) => void
  onFileActivate?: (file: LocalFile) => void
}) {
  const local = useLocal()
  const fileActivity = useFileActivity()
  const level = props.level ?? 0
  const rootPath = props.workspacePath ?? props.path
  const showHidden = props.showHidden ?? false
  const hideActivityFiles = props.hideActivityFiles ?? false

  // Get children and filter out hidden files unless showHidden is true
  // Also filter out files with activity if hideActivityFiles is true
  const children = createMemo(() => {
    const allChildren = local.file.children(props.path)
    return allChildren.filter((node) => {
      // Filter hidden files
      if (!showHidden && node.name.startsWith(".")) return false
      // Filter activity files (only for files, not directories)
      if (hideActivityFiles && node.type === "file" && fileActivity.has(node.absolute)) return false
      return true
    })
  })

  // Sort children: directories first, then files, alphabetically within each group
  const sortedChildren = createMemo(() => {
    return [...children()].sort((a, b) => {
      // Directories first
      if (a.type === "directory" && b.type !== "directory") return -1
      if (a.type !== "directory" && b.type === "directory") return 1
      // Alphabetical within same type
      return a.name.localeCompare(b.name)
    })
  })

  const getRelativePath = (absolutePath: string) => {
    if (absolutePath.startsWith(rootPath)) {
      const relative = absolutePath.slice(rootPath.length)
      return relative.startsWith("/") ? relative.slice(1) : relative
    }
    return absolutePath
  }

  const Node = (p: ParentProps & ComponentProps<"div"> & { node: LocalFile; as?: "div" | "button" }) => {
    // T017: Get activity state for this node (use absolute path since tool events send absolute paths)
    const activity = () => fileActivity.get(p.node.absolute)
    // T029/T030: Get directory activity for collapsed directories
    const directoryActivity = () => p.node.type === "directory" ? fileActivity.getDirectoryActivity(p.node.absolute) : undefined
    // Combined activity (file's own or directory's aggregated)
    const nodeActivity = () => activity() ?? (directoryActivity() ? { type: directoryActivity()! } : undefined)
    const activityConfig = () => nodeActivity() ? ACTIVITY_VISUAL_CONFIG[nodeActivity()!.type] : undefined

    return (
      <Dynamic
        component={p.as ?? "div"}
        classList={{
          "py-1 px-2 w-full flex items-center gap-x-1.5 rounded-md cursor-pointer transition-all duration-150": true,
          "hover:bg-surface-raised-base-hover": props.selectedPath !== p.node.path && !nodeActivity(),
          "bg-surface-interactive-base border border-border-weak-selected": props.selectedPath === p.node.path,
          // Activity-specific backgrounds (only when not selected)
          [activityConfig()?.background ?? ""]: !!nodeActivity() && props.selectedPath !== p.node.path,
          [activityConfig()?.border ?? ""]: !!nodeActivity() && props.selectedPath !== p.node.path,
          [props.nodeClass ?? ""]: !!props.nodeClass,
        }}
        style={`padding-left: ${level * 12 + 8}px`}
        draggable={true}
        onDragStart={(e: any) => {
          const evt = e as globalThis.DragEvent
          evt.dataTransfer!.effectAllowed = "copy"
          evt.dataTransfer!.setData("text/plain", `file:${p.node.path}`)

          // Create custom drag image without margins
          const dragImage = document.createElement("div")
          dragImage.className =
            "flex items-center gap-x-2 px-2 py-1 bg-background-element rounded-md border border-border-1"
          dragImage.style.position = "absolute"
          dragImage.style.top = "-1000px"

          // Copy only the icon and text content without padding
          const icon = e.currentTarget.querySelector("svg")
          const text = e.currentTarget.querySelector("span")
          if (icon && text) {
            dragImage.innerHTML = icon.outerHTML + text.outerHTML
          }

          document.body.appendChild(dragImage)
          evt.dataTransfer!.setDragImage(dragImage, 0, 12)
          setTimeout(() => document.body.removeChild(dragImage), 0)
        }}
        {...p}
      >
        {p.children}
        <span
          classList={{
            "text-14-regular whitespace-nowrap truncate flex-1 text-left": true,
            "text-text-subtle": p.node.ignored && props.selectedPath !== p.node.path,
            "text-text-base": !p.node.ignored && props.selectedPath !== p.node.path,
            "text-text-strong": props.selectedPath === p.node.path,
          }}
        >
          {p.node.name}
        </span>
      </Dynamic>
    )
  }

  return (
    <div class={`flex flex-col ${props.class ?? ""}`} role="group">
      <For each={sortedChildren()}>
        {(node) => {
          const relativePath = getRelativePath(node.path)
          // Don't show tooltip if it's just the filename (no additional info)
          const showTooltip = relativePath !== node.name && relativePath.length > 0
          return (
          <Tooltip forceMount={false} openDelay={1000} value={relativePath} placement="right" inactive={!showTooltip}>
            <Switch>
              <Match when={node.type === "directory"}>
                <div role="treeitem">
                  <Collapsible
                    variant="ghost"
                    class="w-full"
                    forceMount={false}
                    onOpenChange={(open) => (open ? local.file.expand(node.path) : local.file.collapse(node.path))}
                  >
                    <Collapsible.Trigger>
                      <Node node={node}>
                        <Collapsible.Arrow class="text-icon-base size-4" />
                        <FileIcon node={node} class="text-icon-base size-5" />
                      </Node>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <FileTree
                        path={node.path}
                        level={level + 1}
                        selectedPath={props.selectedPath}
                        workspacePath={rootPath}
                        showHidden={showHidden}
                        hideActivityFiles={hideActivityFiles}
                        onFileClick={props.onFileClick}
                        onFileActivate={props.onFileActivate}
                      />
                    </Collapsible.Content>
                  </Collapsible>
                </div>
              </Match>
              <Match when={node.type === "file"}>
                <Node
                  node={node}
                  as="button"
                  role="treeitem"
                  aria-selected={props.selectedPath === node.path}
                  onClick={() => props.onFileClick?.(node)}
                  onDblClick={() => props.onFileActivate?.(node)}
                >
                  <div class="size-4 shrink-0" />
                  <FileIcon node={node} class="text-icon-base size-4" />
                </Node>
              </Match>
            </Switch>
          </Tooltip>
        )}}
      </For>
    </div>
  )
}
