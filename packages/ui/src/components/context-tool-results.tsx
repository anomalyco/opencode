import { createMemo, createSignal, For, onMount } from "solid-js"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/util/path"
import { useReducedMotion } from "../hooks/use-reduced-motion"
import { useI18n } from "../context/i18n"
import { ToolCall } from "./basic-tool"
import { ToolStatusTitle } from "./tool-status-title"
import { AnimatedCountList } from "./tool-count-summary"
import { RollingResults } from "./rolling-results"
import { GROW_SPRING } from "./motion"
import { useSpring } from "./motion-spring"
import { busy, updateScrollMask, useCollapsible, useRowWipe } from "./tool-utils"

function contextToolLabel(part: ToolPart): { action: string; detail: string } {
  const state = part.state
  const title = "title" in state ? (state.title as string | undefined) : undefined
  const input = state.input
  if (part.tool === "read") {
    const path = input?.filePath as string | undefined
    return { action: "Read", detail: title || (path ? getFilename(path) : "") }
  }
  if (part.tool === "grep") {
    const pattern = input?.pattern as string | undefined
    return { action: "Search", detail: title || (pattern ? `"${pattern}"` : "") }
  }
  if (part.tool === "glob") {
    const pattern = input?.pattern as string | undefined
    return { action: "Find", detail: title || (pattern ?? "") }
  }
  if (part.tool === "list") {
    const path = input?.path as string | undefined
    return { action: "List", detail: title || (path ? getFilename(path) : "") }
  }
  return { action: part.tool, detail: title || "" }
}

function contextToolSummary(parts: ToolPart[]) {
  let read = 0
  let search = 0
  let list = 0
  for (const part of parts) {
    if (part.tool === "read") read++
    else if (part.tool === "glob" || part.tool === "grep") search++
    else if (part.tool === "list") list++
  }
  return { read, search, list }
}

export function ContextToolGroupHeader(props: {
  parts: ToolPart[]
  pending: boolean
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const i18n = useI18n()
  const summary = createMemo(() => contextToolSummary(props.parts))
  return (
    <ToolCall
      variant="row"
      icon="magnifying-glass-menu"
      open={props.open}
      showArrow
      onOpenChange={props.onOpenChange}
      trigger={
        <div data-component="context-tool-group-trigger" data-pending={props.pending || undefined}>
          <span
            data-slot="context-tool-group-title"
            class="min-w-0 flex items-center gap-2 text-14-medium text-text-strong"
          >
            <span data-slot="context-tool-group-label" class="shrink-0">
              <ToolStatusTitle
                active={props.pending}
                activeText={i18n.t("ui.sessionTurn.status.gatheringContext")}
                doneText={i18n.t("ui.sessionTurn.status.gatheredContext")}
                split={false}
              />
            </span>
            <span
              data-slot="context-tool-group-summary"
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text-base"
            >
              <AnimatedCountList
                items={[
                  {
                    key: "read",
                    count: summary().read,
                    one: i18n.t("ui.messagePart.context.read.one"),
                    other: i18n.t("ui.messagePart.context.read.other"),
                  },
                  {
                    key: "search",
                    count: summary().search,
                    one: i18n.t("ui.messagePart.context.search.one"),
                    other: i18n.t("ui.messagePart.context.search.other"),
                  },
                  {
                    key: "list",
                    count: summary().list,
                    one: i18n.t("ui.messagePart.context.list.one"),
                    other: i18n.t("ui.messagePart.context.list.other"),
                  },
                ]}
                fallback=""
              />
            </span>
          </span>
        </div>
      }
    />
  )
}

export function ContextToolExpandedList(props: { parts: ToolPart[]; expanded: boolean }) {
  let contentRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let scrollRef: HTMLDivElement | undefined
  const updateMask = () => {
    if (scrollRef) updateScrollMask(scrollRef)
  }

  useCollapsible({
    content: () => contentRef,
    body: () => bodyRef,
    open: () => props.expanded,
    onOpen: updateMask,
  })

  return (
    <div ref={contentRef} style={{ overflow: "clip", height: "0px", display: "none" }}>
      <div ref={bodyRef}>
        <div ref={scrollRef} data-component="context-tool-expanded-list" onScroll={updateMask}>
          <For each={props.parts}>
            {(part) => {
              const label = createMemo(() => contextToolLabel(part))
              return (
                <div data-component="context-tool-expanded-row">
                  <span data-slot="context-tool-expanded-action">{label().action}</span>
                  <span data-slot="context-tool-expanded-detail">{label().detail}</span>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}

export function ContextToolRollingResults(props: { parts: ToolPart[]; pending: boolean }) {
  const reduce = useReducedMotion()
  const wiped = new Set<string>()
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))
  const show = () => mounted() && props.pending
  const opacity = useSpring(() => (show() ? 1 : 0), GROW_SPRING)
  const blur = useSpring(() => (show() ? 0 : 2), GROW_SPRING)
  return (
    <div style={{ opacity: reduce() ? (show() ? 1 : 0) : opacity(), filter: `blur(${reduce() ? 0 : blur()}px)` }}>
      <RollingResults
        items={props.parts}
        rows={5}
        rowHeight={22}
        rowGap={0}
        open={props.pending}
        animate
        getKey={(part) => part.callID || part.id}
        render={(part) => {
          const label = createMemo(() => contextToolLabel(part))
          const k = part.callID || part.id
          return (
            <div data-component="context-tool-rolling-row">
              <span data-slot="context-tool-rolling-action">{label().action}</span>
              {(() => {
                const [detailRef, setDetailRef] = createSignal<HTMLSpanElement>()
                useRowWipe({
                  id: () => k,
                  text: () => label().detail,
                  ref: detailRef,
                  seen: wiped,
                })
                return (
                  <span
                    ref={setDetailRef}
                    data-slot="context-tool-rolling-detail"
                    style={{ display: label().detail ? undefined : "none" }}
                  >
                    {label().detail}
                  </span>
                )
              })()}
            </div>
          )
        }}
      />
    </div>
  )
}
