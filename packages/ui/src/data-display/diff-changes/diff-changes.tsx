import { createMemo, Show } from "solid-js"
import "./diff-changes.css"

export function DiffChanges(props: {
  class?: string
  appearance?: "standard" | "compact"
  hideZero?: boolean
  changes: { additions: number; deletions: number } | { additions: number; deletions: number }[]
}) {
  const additions = createMemo(() =>
    Array.isArray(props.changes)
      ? props.changes.reduce((acc, diff) => acc + (diff.additions ?? 0), 0)
      : props.changes.additions,
  )
  const deletions = createMemo(() =>
    Array.isArray(props.changes)
      ? props.changes.reduce((acc, diff) => acc + (diff.deletions ?? 0), 0)
      : props.changes.deletions,
  )
  const total = createMemo(() => (additions() ?? 0) + (deletions() ?? 0))

  return (
    <Show when={total() > 0}>
      <div
        data-component="diff-changes"
        data-appearance={props.appearance ?? "compact"}
        classList={{ [props.class ?? ""]: true }}
      >
        <Show when={!props.hideZero || additions() > 0}>
          <span data-slot="diff-changes-additions">{`+${additions()}`}</span>
        </Show>
        <Show when={!props.hideZero || deletions() > 0}>
          <span data-slot="diff-changes-deletions">{`-${deletions()}`}</span>
        </Show>
      </div>
    </Show>
  )
}
