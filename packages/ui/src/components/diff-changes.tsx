import type { FileDiff } from "@opencode-ai/sdk"
import { createMemo, Show } from "solid-js"

export function DiffChanges(props: { diff: FileDiff | FileDiff[] }) {
  const additions = createMemo(() =>
    Array.isArray(props.diff)
      ? props.diff.reduce((acc, diff) => acc + (diff.additions ?? 0), 0)
      : props.diff.additions,
  )
  const deletions = createMemo(() =>
    Array.isArray(props.diff)
      ? props.diff.reduce((acc, diff) => acc + (diff.deletions ?? 0), 0)
      : props.diff.deletions,
  )
  const total = createMemo(() => (additions() ?? 0) + (deletions() ?? 0))
  return (
    <Show when={total() > 0}>
      <div data-component="diff-changes">
        <span data-slot="additions">{`+${additions()}`}</span>
        <span data-slot="deletions">{`-${deletions()}`}</span>
      </div>
    </Show>
  )
}
