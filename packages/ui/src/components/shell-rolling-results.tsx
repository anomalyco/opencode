import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"
import { useI18n } from "../context/i18n"
import { RollingResults } from "./rolling-results"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { TextShimmer } from "./text-shimmer"
import { Tooltip } from "./tooltip"
import { GROW_SPRING } from "./motion"
import { useSpring } from "./motion-spring"
import {
  busy,
  createThrottledValue,
  hold,
  updateScrollMask,
  useCollapsible,
  useRowWipe,
  useToolFade,
} from "./tool-utils"

function ShellRollingSubtitle(props: { text: string; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { wipe: true, animate: props.animate })

  return (
    <span data-slot="shell-rolling-subtitle">
      <span ref={ref}>{props.text}</span>
    </span>
  )
}

function firstLine(text: string) {
  return text
    .split(/\r\n|\n|\r/g)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
}

function shellRows(output: string) {
  const rows: { id: string; text: string }[] = []
  const lines = output
    .split(/\r\n|\n|\r/g)
    .map((item) => item.trimEnd())
    .filter((item) => item.length > 0)
  const start = Math.max(0, lines.length - 80)
  for (let i = start; i < lines.length; i++) {
    rows.push({ id: `line:${i}`, text: lines[i]! })
  }

  return rows
}

function ShellRollingCommand(props: { text: string; animate?: boolean }) {
  let ref: HTMLSpanElement | undefined
  useToolFade(() => ref, { wipe: true, animate: props.animate })

  return (
    <div data-component="shell-rolling-command">
      <span ref={ref} data-slot="shell-rolling-text">
        <span data-slot="shell-rolling-prompt">$</span> {props.text}
      </span>
    </div>
  )
}

function ShellExpanded(props: { cmd: string; out: string; open: boolean }) {
  const i18n = useI18n()
  const rows = 10
  const rowHeight = 22
  const max = rows * rowHeight

  let contentRef: HTMLDivElement | undefined
  let bodyRef: HTMLDivElement | undefined
  let scrollRef: HTMLDivElement | undefined
  let topRef: HTMLDivElement | undefined
  const [copied, setCopied] = createSignal(false)
  const [cap, setCap] = createSignal(max)

  const updateMask = () => {
    if (scrollRef) updateScrollMask(scrollRef)
  }

  const resize = () => {
    const top = Math.ceil(topRef?.getBoundingClientRect().height ?? 0)
    setCap(Math.max(rowHeight * 2, max - top - (props.out ? 1 : 0)))
  }

  const measure = () => {
    resize()
    return Math.ceil(bodyRef?.getBoundingClientRect().height ?? 0)
  }

  onMount(() => {
    resize()
    if (!topRef) return
    const obs = new ResizeObserver(resize)
    obs.observe(topRef)
    onCleanup(() => obs.disconnect())
  })

  createEffect(() => {
    props.cmd
    props.out
    queueMicrotask(() => {
      resize()
      updateMask()
    })
  })

  useCollapsible({
    content: () => contentRef,
    body: () => bodyRef,
    open: () => props.open,
    measure,
    onOpen: updateMask,
  })

  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation()
    const cmd = props.cmd ? `$ ${props.cmd}` : ""
    const text = `${cmd}${props.out ? `${cmd ? "\n\n" : ""}${props.out}` : ""}`
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div ref={contentRef} style={{ overflow: "clip", height: "0px", display: "none" }}>
      <div ref={bodyRef} data-component="shell-expanded-shell">
        <div data-slot="shell-expanded-body">
          <div ref={topRef} data-slot="shell-expanded-top">
            <div data-slot="shell-expanded-command">
              <span data-slot="shell-expanded-prompt">$</span>
              <span data-slot="shell-expanded-input">{props.cmd}</span>
            </div>
            <div data-slot="shell-expanded-actions">
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                placement="top"
                gutter={4}
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="small"
                  variant="ghost"
                  class="shell-expanded-copy"
                  onMouseDown={(e: MouseEvent) => e.preventDefault()}
                  onClick={handleCopy}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                />
              </Tooltip>
            </div>
          </div>
          <Show when={props.out}>
            <>
              <div data-slot="shell-expanded-divider" />
              <div
                ref={scrollRef}
                data-component="shell-expanded-output"
                data-scrollable
                onScroll={updateMask}
                style={{ "max-height": `${cap()}px` }}
              >
                <pre data-slot="shell-expanded-pre">
                  <code>{props.out}</code>
                </pre>
              </div>
            </>
          </Show>
        </div>
      </div>
    </div>
  )
}

export function ShellRollingResults(props: { part: ToolPart; animate?: boolean }) {
  const i18n = useI18n()
  const wiped = new Set<string>()
  const [mounted, setMounted] = createSignal(false)
  const [userToggled, setUserToggled] = createSignal(false)
  const [userOpen, setUserOpen] = createSignal(false)
  onMount(() => setMounted(true))
  const state = createMemo(() => props.part.state as Record<string, any>)
  const pending = createMemo(() => busy(props.part.state.status))
  const autoOpen = hold(pending, 2000)
  const effectiveOpen = createMemo(() => {
    if (pending()) return true
    if (userToggled()) return userOpen()
    return autoOpen()
  })
  const expanded = createMemo(() => !pending() && !autoOpen() && userToggled() && userOpen())
  const previewOpen = createMemo(() => effectiveOpen() && !expanded())
  const command = createMemo(() => {
    const value = state().input?.command ?? state().metadata?.command
    if (typeof value === "string") return value
    return ""
  })
  const subtitle = createMemo(() => {
    const value = state().input?.description ?? state().metadata?.description
    if (typeof value === "string" && value.trim().length > 0) return value
    return firstLine(command()) ?? ""
  })
  const output = createMemo(() => {
    const value = state().output ?? state().metadata?.output
    if (typeof value === "string") return value
    return ""
  })
  const reduce = prefersReducedMotion
  const skip = () => reduce() || props.animate === false
  const opacity = useSpring(() => (mounted() ? 1 : 0), GROW_SPRING)
  const blur = useSpring(() => (mounted() ? 0 : 2), GROW_SPRING)
  const previewOpacity = useSpring(() => (previewOpen() ? 1 : 0), GROW_SPRING)
  const previewBlur = useSpring(() => (previewOpen() ? 0 : 2), GROW_SPRING)
  const headerHeight = useSpring(() => (mounted() ? 37 : 0), GROW_SPRING)
  let headerClipRef: HTMLDivElement | undefined
  const handleHeaderClick = () => {
    if (pending()) return
    const el = headerClipRef
    const viewport = el?.closest(".scroll-view__viewport") as HTMLElement | null
    const beforeY = el?.getBoundingClientRect().top ?? 0
    setUserToggled(true)
    setUserOpen((prev) => !prev)
    if (viewport && el) {
      requestAnimationFrame(() => {
        const afterY = el.getBoundingClientRect().top
        const delta = afterY - beforeY
        if (delta !== 0) viewport.scrollTop += delta
      })
    }
  }
  const line = createMemo(() => firstLine(command()))
  const fixed = createMemo(() => {
    const value = line()
    if (!value) return
    return <ShellRollingCommand text={value} animate={props.animate} />
  })
  const text = createThrottledValue(() => stripAnsi(output()))
  const rows = createMemo(() => shellRows(text()))

  return (
    <div
      data-component="shell-rolling-results"
      style={{ opacity: skip() ? (mounted() ? 1 : 0) : opacity(), filter: `blur(${skip() ? 0 : blur()}px)` }}
    >
      <div
        ref={headerClipRef}
        data-slot="shell-rolling-header-clip"
        data-scroll-preserve
        data-clickable={!pending() ? "true" : "false"}
        onClick={handleHeaderClick}
        style={{ height: `${skip() ? (mounted() ? 37 : 0) : headerHeight()}px`, overflow: "clip" }}
      >
        <div data-slot="shell-rolling-header">
          <span data-slot="shell-rolling-title">
            <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
          </span>
          <Show when={subtitle()}>{(text) => <ShellRollingSubtitle text={text()} animate={props.animate} />}</Show>
          <Show when={!pending()}>
            <span data-slot="shell-rolling-actions">
              <span data-slot="shell-rolling-arrow" data-open={effectiveOpen() ? "true" : "false"}>
                <Icon name="chevron-down" size="small" />
              </span>
            </span>
          </Show>
        </div>
      </div>
      <div
        data-slot="shell-rolling-preview"
        style={{
          opacity: skip() ? (previewOpen() ? 1 : 0) : previewOpacity(),
          filter: `blur(${skip() ? 0 : previewBlur()}px)`,
        }}
      >
        <RollingResults
          class="shell-rolling-output"
          noFadeOnCollapse
          items={rows()}
          fixed={fixed()}
          fixedHeight={22}
          rows={5}
          rowHeight={22}
          rowGap={0}
          open={previewOpen()}
          animate={props.animate !== false}
          getKey={(row) => row.id}
          render={(row) => {
            const [textRef, setTextRef] = createSignal<HTMLSpanElement>()
            useRowWipe({
              id: () => row.id,
              text: () => row.text,
              ref: textRef,
              seen: wiped,
            })
            return (
              <div data-component="shell-rolling-row">
                <span ref={setTextRef} data-slot="shell-rolling-text">
                  {row.text}
                </span>
              </div>
            )
          }}
        />
      </div>
      <ShellExpanded cmd={command()} out={text()} open={expanded()} />
    </div>
  )
}
