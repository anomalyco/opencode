import { FileDiff } from "@opencode-ai/sdk"
import { createMemo, Show } from "solid-js"

export function DiffChanges(props: { diff: FileDiff | FileDiff[] }) {
  const additions = createMemo(() =>
    Array.isArray(props.diff) ? props.diff.reduce((acc, diff) => acc + (diff.additions ?? 0), 0) : props.diff.additions,
  )
  const deletions = createMemo(() =>
    Array.isArray(props.diff) ? props.diff.reduce((acc, diff) => acc + (diff.deletions ?? 0), 0) : props.diff.deletions,
  )
  const total = createMemo(() => additions() + deletions())
  return (
    <Show when={total() > 0}>
      <div class="flex gap-2 justify-end items-center">
        <span class="text-12-mono text-right text-text-diff-add-base">{`+${additions()}`}</span>
        <span class="text-12-mono text-right text-text-diff-delete-base">{`-${deletions()}`}</span>
      </div>
    </Show>
  )
}
