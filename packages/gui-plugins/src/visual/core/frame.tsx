import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { CloseIcon, ExpandIcon, IconButton } from "./controls"
import type { VisualKind, VisualSpec } from "./spec"

const KIND_KEY: Record<VisualKind, string> = {
  plot: "kind.plot",
}

export function VisualFrame(props: {
  spec: VisualSpec
  stage: JSX.Element
  readouts?: JSX.Element
  height?: number
  caption?: string
  note?: string
}) {
  const ctx = usePlugin()
  const [full, setFull] = createSignal(false)
  let card: HTMLDivElement | undefined
  let trigger: HTMLElement | undefined

  const toggle = async () => {
    if (!card) return

    if (document.fullscreenElement === card) {
      await document.exitFullscreen().catch(() => undefined)

      return
    }

    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    await card.requestFullscreen().catch(() => undefined)
  }

  onMount(() => {
    const onFullscreen = () => {
      const value = document.fullscreenElement === card
      setFull(value)

      if (!value) trigger?.focus()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && full()) document.exitFullscreen().catch(() => undefined)
    }

    document.addEventListener("fullscreenchange", onFullscreen)
    window.addEventListener("keydown", onKey)

    onCleanup(() => {
      document.removeEventListener("fullscreenchange", onFullscreen)
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <div ref={card} class="vz" aria-label={props.spec.title}>
      <header class="vz-header">
        <div class="vz-heading">
          <div class="vz-kicker">
            <span>{ctx.t(KIND_KEY[props.spec.kind])}</span>
            <Show when={props.spec.unit}>
              <i class="vz-dot" aria-hidden="true" />
              <span>{props.spec.unit}</span>
            </Show>
          </div>
          <h3 class="vz-title">{props.spec.title}</h3>
          <Show when={props.spec.subtitle}>
            <p class="vz-subtitle">{props.spec.subtitle}</p>
          </Show>
        </div>
        <div class="vz-tools">
          <IconButton
            label={full() ? ctx.t("frame.exitFullscreen") : ctx.t("frame.fullscreen")}
            pressed={full()}
            onClick={toggle}
          >
            {full() ? <CloseIcon /> : <ExpandIcon />}
          </IconButton>
        </div>
      </header>

      <div
        class="vz-stage"
        style={
          props.height || props.spec.height
            ? { "min-height": `${Math.min(720, props.height ?? props.spec.height ?? 0)}px` }
            : undefined
        }
      >
        {props.stage}
      </div>

      <Show when={props.readouts}>
        <div class="vz-controls">{props.readouts}</div>
      </Show>

      <Show when={props.caption ?? props.spec.caption ?? props.note ?? props.spec.note ?? props.spec.source}>
        <footer class="vz-foot">
          <Show when={props.caption ?? props.spec.caption}>
            <p class="vz-caption">{props.caption ?? props.spec.caption}</p>
          </Show>
          <Show when={props.note ?? props.spec.note}>
            <p class="vz-note">
              <b>{ctx.t("frame.assumptions")}</b> {props.note ?? props.spec.note}
            </p>
          </Show>
          <Show when={props.spec.source}>
            {(source) => (
              <div class="vz-meta">
                <span>{ctx.t("frame.source", { source: source() })}</span>
              </div>
            )}
          </Show>
        </footer>
      </Show>
    </div>
  )
}
