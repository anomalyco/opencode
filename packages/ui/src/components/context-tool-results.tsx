import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from "solid-js"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/util/path"
import { useI18n } from "../context/i18n"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"
import { ToolCall } from "./basic-tool"
import { ToolStatusTitle } from "./tool-status-title"
import { AnimatedCountList } from "./tool-count-summary"
import { RollingResults } from "./rolling-results"
import {
  animate,
  type AnimationPlaybackControls,
  clearFadeStyles,
  clearMaskStyles,
  COLLAPSIBLE_SPRING,
  GROW_SPRING,
  WIPE_MASK,
} from "./motion"
import { useSpring } from "./motion-spring"
import { busy } from "./tool-utils"

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
      open={!props.pending && props.open}
      showArrow={!props.pending}
      onOpenChange={(v) => {
        if (!props.pending) props.onOpenChange(v)
      }}
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
  let heightAnim: AnimationPlaybackControls | undefined
  let fadeAnim: AnimationPlaybackControls | undefined

  const FADE = 12

  const updateMask = () => {
    if (!scrollRef) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef
    const overflow = scrollHeight - clientHeight
    if (overflow <= 1) {
      scrollRef.style.maskImage = ""
      scrollRef.style.webkitMaskImage = ""
      return
    }
    const top = scrollTop > 1
    const bottom = scrollTop < overflow - 1
    const mask =
      top && bottom
        ? `linear-gradient(to bottom, transparent 0, black ${FADE}px, black calc(100% - ${FADE}px), transparent 100%)`
        : top
          ? `linear-gradient(to bottom, transparent 0, black ${FADE}px)`
          : bottom
            ? `linear-gradient(to bottom, black calc(100% - ${FADE}px), transparent 100%)`
            : ""
    scrollRef.style.maskImage = mask
    scrollRef.style.webkitMaskImage = mask
  }

  createEffect(
    on(
      () => props.expanded,
      (isOpen) => {
        if (!contentRef || !bodyRef) return
        heightAnim?.stop()
        fadeAnim?.stop()
        if (isOpen) {
          contentRef.style.display = ""
          bodyRef.style.opacity = "0"
          bodyRef.style.filter = "blur(2px)"
          const h = bodyRef.getBoundingClientRect().height
          heightAnim = animate(contentRef, { height: ["0px", `${h}px`] }, COLLAPSIBLE_SPRING)
          fadeAnim = animate(bodyRef, { opacity: [0, 1], filter: ["blur(2px)", "blur(0px)"] }, COLLAPSIBLE_SPRING)
          heightAnim.finished
            .catch(() => {})
            .then(() => {
              if (!contentRef || !props.expanded) return
              contentRef.style.height = "auto"
              updateMask()
            })
        } else {
          const h = contentRef.getBoundingClientRect().height
          heightAnim = animate(contentRef, { height: [`${h}px`, "0px"] }, COLLAPSIBLE_SPRING)
          fadeAnim = animate(bodyRef, { opacity: [1, 0], filter: ["blur(0px)", "blur(2px)"] }, COLLAPSIBLE_SPRING)
          heightAnim.finished
            .catch(() => {})
            .then(() => {
              if (!contentRef || props.expanded) return
              contentRef.style.display = "none"
            })
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
    fadeAnim?.stop()
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
  const wiped = new Set<string>()
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))
  const reduce = prefersReducedMotion
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
                createEffect(() => {
                  const el = detailRef()
                  const d = label().detail
                  if (!el || !d) return
                  if (wiped.has(k)) return
                  wiped.add(k)
                  if (reduce()) return
                  el.style.maskImage = WIPE_MASK
                  el.style.webkitMaskImage = WIPE_MASK
                  el.style.maskSize = "240% 100%"
                  el.style.webkitMaskSize = "240% 100%"
                  el.style.maskRepeat = "no-repeat"
                  el.style.webkitMaskRepeat = "no-repeat"
                  el.style.maskPosition = "100% 0%"
                  el.style.webkitMaskPosition = "100% 0%"
                  animate(
                    el,
                    {
                      opacity: [0, 1],
                      filter: ["blur(2px)", "blur(0px)"],
                      transform: ["translateX(-0.06em)", "translateX(0)"],
                      maskPosition: "0% 0%",
                    },
                    GROW_SPRING,
                  ).finished.then(() => {
                    if (!el) return
                    clearFadeStyles(el)
                    clearMaskStyles(el)
                  })
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
