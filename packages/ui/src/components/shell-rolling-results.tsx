import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"
import { useI18n } from "../context/i18n"
import { RollingResults } from "./rolling-results"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { TextShimmer } from "./text-shimmer"
import { Tooltip } from "./tooltip"
import {
  animate,
  clearFadeStyles,
  clearMaskStyles,
  FAST_SPRING,
  GROW_SPRING,
  WIPE_MASK,
} from "./motion"
import { useSpring } from "./motion-spring"
import { busy, createThrottledValue, useToolFade } from "./tool-utils"

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

export function ShellRollingResults(props: { part: ToolPart; animate?: boolean }) {
  const i18n = useI18n()
  const wiped = new Set<string>()
  const [mounted, setMounted] = createSignal(false)
  const [userToggled, setUserToggled] = createSignal(false)
  const [userOpen, setUserOpen] = createSignal(false)
  onMount(() => setMounted(true))
  const state = createMemo(() => props.part.state as Record<string, any>)
  const pending = createMemo(() => busy(props.part.state.status))
  // autoOpen starts true if pending, false if already complete (e.g. scrolling back in history).
  // When pending transitions false, autoOpen is still true — no intermediate state — then
  // a 2s timer sets it false to trigger the collapse. This avoids the flash caused by
  // holdOpen being set in a late-running effect.
  const [autoOpen, setAutoOpen] = createSignal(pending())
  createEffect(on(pending, (isPending, wasPending) => {
    if (isPending) {
      setAutoOpen(true)
    } else if (wasPending && !userToggled()) {
      const timer = setTimeout(() => setAutoOpen(false), 2000)
      onCleanup(() => clearTimeout(timer))
    }
  }))
  const effectiveOpen = createMemo(() => {
    if (pending()) return true
    if (userToggled()) return userOpen()
    return autoOpen()
  })
  const subtitle = createMemo(() => {
    const value = state().input?.description ?? state().metadata?.description
    if (typeof value === "string") return value
    return ""
  })
  const command = createMemo(() => {
    const value = state().input?.command ?? state().metadata?.command
    if (typeof value === "string") return value
    return ""
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
  const headerHeight = useSpring(() => (mounted() ? 37 : 0), GROW_SPRING)
  let headerClipRef: HTMLDivElement | undefined
  const [copied, setCopied] = createSignal(false)
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
  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation()
    const cmd = command()
    const out = stripAnsi(output())
    const content = `$ ${cmd}${out ? "\n" + out : ""}`
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          <Show when={subtitle()}>
            {(text) => <ShellRollingSubtitle text={text()} animate={props.animate} />}
          </Show>
          <Show when={!pending()}>
            <span data-slot="shell-rolling-actions">
              <Tooltip
                value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                placement="top"
                gutter={4}
              >
                <IconButton
                  icon={copied() ? "check" : "copy"}
                  size="small"
                  variant="ghost"
                  class="shell-rolling-copy"
                  onMouseDown={(e: MouseEvent) => e.preventDefault()}
                  onClick={handleCopy}
                  aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                />
              </Tooltip>
              <span data-slot="shell-rolling-arrow" data-open={effectiveOpen() ? "true" : "false"}>
                <Icon name="chevron-down" size="small" />
              </span>
            </span>
          </Show>
        </div>
      </div>
      <RollingResults
        class="shell-rolling-output"
        items={rows()}
        fixed={fixed()}
        fixedHeight={22}
        rows={5}
        rowHeight={22}
        rowGap={0}
        open={effectiveOpen()}
        scrollable={!pending() && !autoOpen() && userToggled() && userOpen()}
        spring={userToggled() ? FAST_SPRING : undefined}
        animate={props.animate !== false}
        getKey={(row) => row.id}
        render={(row) => {
          const [textRef, setTextRef] = createSignal<HTMLSpanElement>()
          createEffect(() => {
            const el = textRef()
            if (!el || !row.text) return
            if (wiped.has(row.id)) return
            wiped.add(row.id)
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
            <div data-component="shell-rolling-row">
              <span ref={setTextRef} data-slot="shell-rolling-text">
                {row.text}
              </span>
            </div>
          )
        }}
      />
    </div>
  )
}
