import { useFile } from "@/context/file"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import {
  createEffect,
  createMemo,
  For,
  Match,
  splitProps,
  Switch,
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
  onFileClick?: (file: FileNode) => void
}) {
  const file = useFile()
  const level = props.level ?? 0

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
          "w-full flex items-center gap-x-2 rounded-md px-2 py-1 hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
          [props.nodeClass ?? ""]: !!props.nodeClass,
        }}
        style={`padding-left: ${8 + level * 12}px`}
        draggable={true}
        onDragStart={(e: DragEvent) => {
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
            "text-12-regular whitespace-nowrap truncate": true,
            "text-text-weaker": local.node.ignored,
            "text-text-weak": !local.node.ignored,
          }}
        >
          {local.node.name}
        </span>
      </Dynamic>
    )
  }

  return (
    <div class={`flex flex-col ${props.class ?? ""}`}>
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          return (
            <Tooltip forceMount={false} openDelay={2000} value={node.path} placement="right">
              <Switch>
                <Match when={node.type === "directory"}>
                  <Collapsible
                    variant="ghost"
                    class="w-full"
                    forceMount={false}
                    open={expanded()}
                    onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                  >
                    <Collapsible.Trigger>
                      <Node node={node}>
                        <Collapsible.Arrow class="text-icon-weak ml-1" />
                        <FileIcon node={node} expanded={expanded()} class="text-icon-weak -ml-1 size-4" />
                      </Node>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <FileTree
                        path={node.path}
                        level={level + 1}
                        allowed={props.allowed}
                        onFileClick={props.onFileClick}
                      />
                    </Collapsible.Content>
                  </Collapsible>
                </Match>
                <Match when={node.type === "file"}>
                  <Node node={node} as="button" type="button" onClick={() => props.onFileClick?.(node)}>
                    <div class="w-4 shrink-0" />
                    <FileIcon node={node} class="text-icon-weak size-4" />
                  </Node>
                </Match>
              </Switch>
            </Tooltip>
          )
        }}
      </For>
    </div>
  )
}
