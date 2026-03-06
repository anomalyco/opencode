import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import stripAnsi from "strip-ansi"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"
import { RollingResults } from "./rolling-results"
import {
  animate,
  clearFadeStyles,
  clearMaskStyles,
  GROW_SPRING,
  WIPE_MASK,
} from "./motion"
import { useSpring } from "./motion-spring"
import { busy, hold, createThrottledValue, useToolFade } from "./tool-utils"

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
  const wiped = new Set<string>()
  const [mounted, setMounted] = createSignal(false)
  onMount(() => setMounted(true))
  const state = createMemo(() => props.part.state as Record<string, any>)
  const pending = createMemo(() => busy(props.part.state.status))
  const open = hold(pending)
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
  const show = () => mounted() && open()
  const opacity = useSpring(() => (show() ? 1 : 0), GROW_SPRING)
  const blur = useSpring(() => (show() ? 0 : 2), GROW_SPRING)
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
      style={{ opacity: reduce() ? (show() ? 1 : 0) : opacity(), filter: `blur(${reduce() ? 0 : blur()}px)` }}
    >
      <RollingResults
        class="shell-rolling-output"
        items={rows()}
        fixed={fixed()}
        fixedHeight={22}
        rows={5}
        rowHeight={22}
        rowGap={0}
        open={open()}
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
