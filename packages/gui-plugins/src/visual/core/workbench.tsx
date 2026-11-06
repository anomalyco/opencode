import { createMemo, createSignal, For, Show } from "solid-js"
import { KIND_LABEL } from "./frame"
import type { VisualSpec } from "./spec"
import { VisualView } from "./view"

export interface VisualEntry {
  readonly id: string
  readonly code: string
  readonly spec: VisualSpec
}

export const SAMPLE = `{
  "v": 1,
  "kind": "mechanism",
  "title": "Crank-rocker linkage",
  "subtitle": "Crank 34 mm, coupler 104 mm, rocker 74 mm, ground 128 mm",
  "unit": "mm",
  "data": {
    "type": "fourbar",
    "a": 34, "b": 104, "c": 74, "d": 128,
    "branch": "open", "rpm": 22
  },
  "caption": "Move the crank and watch the rocker reverse direction at its limits.",
  "note": "Planar rigid-body kinematics, no joint clearance or elastic deflection."
}`

export function Workbench(props: {
  entries: readonly VisualEntry[]
  sessionKey: string
  initialID?: string
  onClose?: () => void
  onCopy?: (text: string) => void
}) {
  const [picked, setPicked] = createSignal<{ key: string; id: string }>()
  const [index, setIndex] = createSignal(false)
  const count = () => props.entries.length

  const current = createMemo(() => {
    const list = props.entries

    if (list.length === 0) return undefined

    const pick = picked()

    if (pick && pick.key === props.sessionKey) {
      const found = list.find((entry) => entry.id === pick.id)

      if (found) return found
    }

    if (props.initialID) {
      const initial = list.find((entry) => entry.id === props.initialID)

      if (initial) return initial
    }

    return list[list.length - 1]
  })

  const selected = () => {
    const entry = current()

    return entry ? props.entries.findIndex((candidate) => candidate.id === entry.id) : -1
  }

  const move = (delta: number) => {
    if (count() === 0) return
    const next = (selected() + delta + count()) % count()
    setPicked({ key: props.sessionKey, id: props.entries[next].id })
  }

  return (
    <div class="vw" data-scrollable>
      <header class="vw-head">
        <div>
          <div class="vw-kicker">This session</div>
          <h2 class="vw-title">Visuals</h2>
        </div>
        <span class="vw-count">{count() === 0 ? "empty" : `${selected() + 1} of ${count()}`}</span>
      </header>

      <Show
        when={count() > 0}
        fallback={
          <div class="vw-empty">
            <p class="vw-empty-title">No visuals yet.</p>
            <p class="vw-empty-body">
              Ask for a diagram, a mechanism, a beam calculation, an assembly, or an assembly. The assistant writes a{" "}
              <code>visual</code> code block and it renders here and inline in the conversation.
            </p>
            <pre class="vw-sample">{SAMPLE}</pre>
            <button type="button" class="vw-button" onClick={() => props.onCopy?.(SAMPLE)}>
              Copy example spec
            </button>
          </div>
        }
      >
        <div class="vw-toolbar">
          <button type="button" class="vw-icon" aria-label="Previous visual" onClick={() => move(-1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3 5 8l5 5" />
            </svg>
          </button>
          <div class="vw-current">
            <span class="vw-kind">{KIND_LABEL[current()!.spec.kind]}</span>
            <span class="vw-name">{current()!.spec.title}</span>
          </div>
          <button type="button" class="vw-icon" aria-label="Next visual" onClick={() => move(1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>
          <button
            type="button"
            class="vw-icon"
            aria-label={index() ? "Hide visual list" : "Show visual list"}
            aria-pressed={index()}
            onClick={() => setIndex((value) => !value)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 5h10M3 8h10M3 11h10" />
            </svg>
          </button>
        </div>

        <Show when={index()}>
          <ol class="vw-list">
            <For each={props.entries}>
              {(entry, item) => (
                <li>
                  <button
                    type="button"
                    class="vw-row"
                    aria-current={item() === selected()}
                    onClick={() => {
                      setPicked({ key: props.sessionKey, id: entry.id })
                      setIndex(false)
                    }}
                  >
                    <span class="vw-row-index">{String(item() + 1).padStart(2, "0")}</span>
                    <span class="vw-row-name">{entry.spec.title}</span>
                    <span class="vw-row-kind">{KIND_LABEL[entry.spec.kind]}</span>
                  </button>
                </li>
              )}
            </For>
          </ol>
        </Show>

        <div class="vw-stage">
          <VisualView code={current()!.code} context="workbench" />
        </div>
      </Show>
    </div>
  )
}
