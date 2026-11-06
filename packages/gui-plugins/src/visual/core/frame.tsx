import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { CloseIcon, ExpandIcon, IconButton, ResetIcon } from "./controls"
import type { VisualKind, VisualSpec } from "./spec"

export const KIND_LABEL: Record<VisualKind, string> = {
  plot: "Plot",
}

export function VisualFrame(props: {
  spec: VisualSpec
  stage: JSX.Element
  controls?: JSX.Element
  readouts?: JSX.Element
  tools?: JSX.Element
  height?: number
  caption?: string
  note?: string
  onReset?: () => void
}) {
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
      <div
        ref={card}
        class="vz"
        classList={{ "vz-full": full() }}
        aria-label={props.spec.title}
      >
        <header class="vz-header">
          <div class="vz-heading">
            <div class="vz-kicker">
              <span>{KIND_LABEL[props.spec.kind]}</span>
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
            {props.tools}
            <Show when={props.onReset}>
              <IconButton label="Reset controls" onClick={() => props.onReset?.()}>
                <ResetIcon />
              </IconButton>
            </Show>
            <IconButton label={full() ? "Exit full screen" : "Full screen"} pressed={full()} onClick={toggle}>
              {full() ? <CloseIcon /> : <ExpandIcon />}
            </IconButton>
          </div>
        </header>

        <div
          class="vz-stage"
          style={props.height || props.spec.height ? { "min-height": `${Math.min(720, props.height ?? props.spec.height ?? 0)}px` } : undefined}
        >
          {props.stage}
        </div>

        <Show when={props.readouts}>
          <div class="vz-controls">{props.readouts}</div>
        </Show>

        <Show when={props.controls}>
          <div class="vz-controls">{props.controls}</div>
        </Show>

        <Show when={props.caption ?? props.spec.caption ?? props.note ?? props.spec.note ?? props.spec.source}>
          <footer class="vz-foot">
            <Show when={props.caption ?? props.spec.caption}>
              <p class="vz-caption">{props.caption ?? props.spec.caption}</p>
            </Show>
            <Show when={props.note ?? props.spec.note}>
              <p class="vz-note">
                <b>Assumptions.</b> {props.note ?? props.spec.note}
              </p>
            </Show>
            <Show when={props.spec.source}>
              <div class="vz-meta">
                <span>Source: {props.spec.source}</span>
              </div>
            </Show>
          </footer>
        </Show>
    </div>
  )
}

export function VisualError(props: { title?: string; message: string }) {
  return (
    <div class="vz-error" role="status">
      <strong>{props.title ?? "This visual could not be drawn"}</strong>
      <code>{props.message}</code>
      <span>Fix the spec, or remove the fence to show a normal code block.</span>
    </div>
  )
}
