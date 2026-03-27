import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "../context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "./collapsible"
import type { IconProps } from "./icon"
import { TextShimmer } from "./text-shimmer"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
}

const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0 }

export function BasicTool(props: BasicToolProps) {
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    ready: props.defaultOpen ?? false,
  })
  const open = () => state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"

  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)
  let searchRef: HTMLInputElement | undefined
  let toolRef: HTMLDivElement | undefined

  const openSearch = () => {
    if (!open()) setState("open", true)
    setSearchOpen(true)
    requestAnimationFrame(() => searchRef?.focus())
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery("")
    clearHighlights()
  }

  const clearHighlights = () => {
    toolRef?.querySelectorAll("mark[data-tool-search]").forEach((el) => {
      const parent = el.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el)
      parent.normalize()
    })
  }

  const applyHighlights = (q: string) => {
    clearHighlights()
    if (!q || !toolRef) return
    const content = toolRef.querySelector("[data-slot='collapsible-content'], [data-component='collapsible-content']")
    if (!content) return
    const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    const matches: { node: Text; start: number }[] = []
    let node: Node | null
    const lower = q.toLowerCase()
    while ((node = walk.nextNode())) {
      const text = node.textContent ?? ""
      let idx = text.toLowerCase().indexOf(lower)
      while (idx !== -1) {
        matches.push({ node: node as Text, start: idx })
        idx = text.toLowerCase().indexOf(lower, idx + 1)
      }
    }
    for (let i = matches.length - 1; i >= 0; i--) {
      const { node, start } = matches[i]
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + q.length)
      const mark = document.createElement("mark")
      mark.setAttribute("data-tool-search", "")
      mark.style.background = "var(--surface-warning-soft, rgba(250,200,50,0.35))"
      mark.style.color = "inherit"
      mark.style.borderRadius = "2px"
      range.surroundContents(mark)
      if (i === 0) mark.scrollIntoView({ block: "nearest" })
    }
  }

  createEffect(() => {
    const q = searchQuery()
    if (!searchOpen()) return
    applyHighlights(q)
  })

  const handleToolKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault()
      e.stopPropagation()
      openSearch()
    }
  }

  let frame: number | undefined

  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  onCleanup(cancel)

  createEffect(() => {
    if (props.forceOpen) setState("open", true)
  })

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        cancel()
        frame = requestAnimationFrame(() => {
          frame = undefined
          if (!open()) return
          setState("ready", true)
        })
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined
  const initialOpen = open()

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.overflow = "visible"
            contentRef.style.height = "auto"
          })
        } else {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    if (props.locked && !value) return
    setState("open", value)
  }

  return (
    <div ref={toolRef} onKeyDown={handleToolKeyDown} tabIndex={-1} class="tool-collapsible-wrapper">
    <Collapsible
      open={open()}
      onOpenChange={handleOpenChange}
      class="tool-collapsible"
    >
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <div data-slot="basic-tool-tool-info">
              <Switch>
                <Match when={isTriggerTitle(props.trigger) && props.trigger}>
                  {(trigger) => (
                    <div data-slot="basic-tool-tool-info-structured">
                      <div data-slot="basic-tool-tool-info-main">
                        <span
                          data-slot="basic-tool-tool-title"
                          classList={{
                            [trigger().titleClass ?? ""]: !!trigger().titleClass,
                          }}
                        >
                          <TextShimmer text={trigger().title} active={pending()} />
                        </span>
                        <Show when={!pending()}>
                          <Show when={trigger().subtitle}>
                            <span
                              data-slot="basic-tool-tool-subtitle"
                              classList={{
                                [trigger().subtitleClass ?? ""]: !!trigger().subtitleClass,
                                clickable: !!props.onSubtitleClick,
                              }}
                              onClick={(e) => {
                                if (props.onSubtitleClick) {
                                  e.stopPropagation()
                                  props.onSubtitleClick()
                                }
                              }}
                            >
                              {trigger().subtitle}
                            </span>
                          </Show>
                          <Show when={trigger().args?.length}>
                            <For each={trigger().args}>
                              {(arg) => (
                                <span
                                  data-slot="basic-tool-tool-arg"
                                  classList={{
                                    [trigger().argsClass ?? ""]: !!trigger().argsClass,
                                  }}
                                >
                                  {arg}
                                </span>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </div>
                      <Show when={!pending() && trigger().action}>
                        <span data-slot="basic-tool-tool-action">{trigger().action}</span>
                      </Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>{props.trigger as JSX.Element}</Match>
              </Switch>
            </div>
          </div>
          <Show when={props.children && !props.hideDetails && !props.locked && !pending()}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={searchOpen()}>
        <div
          data-slot="basic-tool-search"
          class="flex items-center gap-2 px-3 py-1.5 border-t border-border-weak-base bg-background-base"
        >
          <input
            ref={searchRef}
            placeholder="Search output…"
            class="flex-1 bg-transparent text-12-regular text-text-strong placeholder:text-text-weakest outline-none"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); closeSearch() }
              if (e.key === "f" && (e.metaKey || e.ctrlKey)) { e.preventDefault() }
            }}
          />
          <Show when={searchQuery()}>
            <span class="text-11-regular text-text-weakest tabular-nums shrink-0">
              {/* match count provided visually via browser highlight */}
            </span>
          </Show>
          <button
            class="text-11-regular text-text-weak hover:text-text-strong transition-colors shrink-0"
            onClick={closeSearch}
            tabIndex={-1}
          >
            ✕
          </button>
        </div>
      </Show>
      <Show when={props.animated && props.children && !props.hideDetails}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: initialOpen ? "auto" : "0px",
            overflow: initialOpen ? "visible" : "hidden",
          }}
        >
          {props.children}
        </div>
      </Show>
      <Show when={!props.animated && props.children && !props.hideDetails}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
    </div>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export function GenericTool(props: {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
}) {
  const i18n = useI18n()

  return (
    <BasicTool
      icon="mcp"
      status={props.status}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails}
    />
  )
}
