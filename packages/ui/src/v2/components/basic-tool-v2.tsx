import { Collapsible } from "@kobalte/core/collapsible"
import {
  type ComponentProps,
  type JSX,
  For,
  Show,
  createMemo,
  splitProps,
} from "solid-js"
import { DiffChanges } from "./diff-changes-v2"
import { TextShimmerV2 } from "./text-shimmer-v2"
import "./basic-tool-v2.css"

function ChevronIcon() {
  return (
    <svg
      data-slot="basic-tool-v2-chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.75194 10.6243C6.41861 10.8187 6 10.5783 6 10.1924V5.80837C6 5.42247 6.41861 5.18204 6.75194 5.37648L10.5096 7.56846C10.8404 7.7614 10.8404 8.2393 10.5096 8.43224L6.75194 10.6243Z"
        fill="currentColor"
      />
    </svg>
  )
}

export interface BasicToolV2TriggerTitle {
  title: string
  subtitle?: string
  args?: string[]
  changes?: { additions: number; deletions: number } | { additions: number; deletions: number }[]
  action?: JSX.Element
}

const isTriggerTitle = (val: unknown): val is BasicToolV2TriggerTitle =>
  typeof val === "object" &&
  val !== null &&
  "title" in val &&
  (typeof Node === "undefined" || !(val instanceof Node))

export interface BasicToolV2Props extends Omit<ComponentProps<"div">, "children" | "title"> {
  trigger: BasicToolV2TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onSubtitleClick?: () => void
}

export function BasicToolV2(props: BasicToolV2Props) {
  const [local, rest] = splitProps(props, [
    "trigger",
    "children",
    "status",
    "open",
    "defaultOpen",
    "onOpenChange",
    "onSubtitleClick",
    "class",
    "classList",
  ])

  const pending = createMemo(() => local.status === "pending" || local.status === "running")

  const hasChildren = createMemo(() => {
    const c = local.children
    if (c == null) return false
    return true
  })

  const canExpand = createMemo(() => hasChildren() && !pending())

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    local.onOpenChange?.(value)
  }

  return (
    <Collapsible
      {...rest}
      data-component="basic-tool-v2"
      open={local.open}
      defaultOpen={local.defaultOpen}
      onOpenChange={handleOpenChange}
      disabled={!canExpand()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Collapsible.Trigger
        as="div"
        role="button"
        data-slot="basic-tool-v2-trigger"
      >
        <div data-slot="basic-tool-v2-labels">
          <Show
            when={isTriggerTitle(local.trigger) && local.trigger}
            fallback={local.trigger as JSX.Element}
          >
            {(title) => (
              <>
                <span data-slot="basic-tool-v2-title">
                  <TextShimmerV2 text={title().title} active={pending()} />
                </span>
                <Show when={!pending() && title().subtitle}>
                  <span data-slot="basic-tool-v2-sep" aria-hidden="true">·</span>
                  <span
                    data-slot="basic-tool-v2-subtitle"
                    style={local.onSubtitleClick ? { cursor: "pointer" } : undefined}
                    onClick={(e) => {
                      if (local.onSubtitleClick) {
                        e.stopPropagation()
                        local.onSubtitleClick()
                      }
                    }}
                  >
                    {title().subtitle}
                  </span>
                </Show>
                <Show when={!pending() && title().args?.length}>
                  <For each={title().args}>
                    {(arg) => (
                      <span data-slot="basic-tool-v2-arg">{arg}</span>
                    )}
                  </For>
                </Show>
                <Show when={!pending() && title().changes}>
                  <span data-slot="basic-tool-v2-diff">
                    <DiffChanges changes={title().changes!} />
                  </span>
                </Show>
                <Show when={!pending() && title().action}>
                  {(action) => action()}
                </Show>
              </>
            )}
          </Show>
          <Show when={canExpand()}>
            <span data-slot="basic-tool-v2-chevron-wrap">
              <ChevronIcon />
            </span>
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={canExpand()}>
        <Collapsible.Content data-slot="basic-tool-v2-content">
          <div data-slot="basic-tool-v2-content-inner">{local.children}</div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}
