import { useFile } from "@/context/file"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import {
  createEffect,
  createMemo,
  For,
  Match,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  draggable?: boolean
  tooltip?: boolean
  onFileClick?: (file: FileNode) => void
}) {
  const file = useFile()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true
  const tooltip = () => props.tooltip ?? true

  const filter = createMemo(() => {
    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    const modified = props.modified
    if (!modified || modified.length === 0) return
    return new Set(modified)
  })

  createEffect(() => {
    const current = filter()
    if (!current) return
    if (level !== 0) return

    for (const dir of current.dirs) {
      const expanded = untrack(() => file.tree.state(dir)?.expanded) ?? false
      if (expanded) continue
      file.tree.expand(dir)
    }
  })

  createEffect(() => {
    void file.tree.list(props.path)
  })

  const nodes = createMemo(() => {
    const nodes = file.tree.children(props.path)
    const current = filter()
    if (!current) return nodes
    return nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })
  })

  const Node = (
    p: ParentProps &
      ComponentProps<"div"> &
      ComponentProps<"button"> & {
        node: FileNode
        as?: "div" | "button"
      },
  ) => {
    const [local, rest] = splitProps(p, ["node", "as", "children", "class", "classList"])
    return (
      <Dynamic
        component={local.as ?? "div"}
        classList={{
          "w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-2 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
          [props.nodeClass ?? ""]: !!props.nodeClass,
        }}
        style={`padding-left: ${Math.max(0, 8 + level * 12 - (local.node.type === "file" ? 24 : 0))}px`}
        draggable={draggable()}
        onDragStart={(e: DragEvent) => {
          if (!draggable()) return
          e.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
          e.dataTransfer?.setData("text/uri-list", `file://${local.node.path}`)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"

          const dragImage = document.createElement("div")
          dragImage.className =
            "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
          dragImage.style.position = "absolute"
          dragImage.style.top = "-1000px"

          const icon =
            (e.currentTarget as HTMLElement).querySelector('[data-component="file-icon"]') ??
            (e.currentTarget as HTMLElement).querySelector("svg")
          const text = (e.currentTarget as HTMLElement).querySelector("span")
          if (icon && text) {
            dragImage.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
          }

          document.body.appendChild(dragImage)
          e.dataTransfer?.setDragImage(dragImage, 0, 12)
          setTimeout(() => document.body.removeChild(dragImage), 0)
        }}
        {...rest}
      >
        {local.children}
        <span
          classList={{
            "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
            "text-text-weaker": local.node.ignored,
            "text-text-weak": !local.node.ignored,
          }}
        >
          {local.node.name}
        </span>
        {local.node.type === "file" && marks()?.has(local.node.path) ? (
          <div class="shrink-0 size-1.5 rounded-full bg-surface-warning-strong" />
        ) : null}
      </Dynamic>
    )
  }

  return (
    <div class={`flex flex-col gap-0.5 ${props.class ?? ""}`}>
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const Wrapper = (p: ParentProps) => {
            if (!tooltip()) return p.children
            return (
              <Tooltip forceMount={false} openDelay={2000} value={node.path} placement="right" class="w-full">
                {p.children}
              </Tooltip>
            )
          }

          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <Collapsible
                  variant="ghost"
                  class="w-full"
                  data-scope="filetree"
                  forceMount={false}
                  open={expanded()}
                  onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                >
                  <Collapsible.Trigger>
                    <Wrapper>
                      <Node node={node}>
                        <div class="size-4 flex items-center justify-center text-icon-weak">
                          <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                        </div>
                      </Node>
                    </Wrapper>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="mt-0.5">
                    <FileTree
                      path={node.path}
                      level={level + 1}
                      allowed={props.allowed}
                      modified={props.modified}
                      draggable={props.draggable}
                      tooltip={props.tooltip}
                      onFileClick={props.onFileClick}
                    />
                  </Collapsible.Content>
                </Collapsible>
              </Match>
              <Match when={node.type === "file"}>
                <Wrapper>
                  <Node node={node} as="button" type="button" onClick={() => props.onFileClick?.(node)}>
                    <div class="w-4 shrink-0" />
                    <FileIcon node={node} class="text-icon-weak size-4" />
                  </Node>
                </Wrapper>
              </Match>
            </Switch>
          )
        }}
      </For>
    </div>
  )
}
