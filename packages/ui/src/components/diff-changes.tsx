import { createMemo, For, Match, Show, Switch } from "solid-js"

export function DiffChanges(props: {
  class?: string
  changes: { additions: number; deletions: number } | { additions: number; deletions: number }[]
  variant?: "default" | "bars"
}) {
  const variant = () => props.variant ?? "default"

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

  const blockCounts = createMemo(() => {
    const TOTAL_BLOCKS = 5

    const adds = additions() ?? 0
    const dels = deletions() ?? 0

    if (adds === 0 && dels === 0) {
      return { added: 0, deleted: 0, neutral: TOTAL_BLOCKS }
    }

    const total = adds + dels

    if (total < 5) {
      const added = adds > 0 ? 1 : 0
      const deleted = dels > 0 ? 1 : 0
      const neutral = TOTAL_BLOCKS - added - deleted
      return { added, deleted, neutral }
    }

    const ratio = adds > dels ? adds / dels : dels / adds
    let BLOCKS_FOR_COLORS = TOTAL_BLOCKS

    if (total < 20) {
      BLOCKS_FOR_COLORS = TOTAL_BLOCKS - 1
    } else if (ratio < 4) {
      BLOCKS_FOR_COLORS = TOTAL_BLOCKS - 1
    }

    const percentAdded = adds / total
    const percentDeleted = dels / total

    const added_raw = percentAdded * BLOCKS_FOR_COLORS
    const deleted_raw = percentDeleted * BLOCKS_FOR_COLORS

    let added = adds > 0 ? Math.max(1, Math.round(added_raw)) : 0
    let deleted = dels > 0 ? Math.max(1, Math.round(deleted_raw)) : 0

    // Cap bars based on actual change magnitude
    if (adds > 0 && adds <= 5) added = Math.min(added, 1)
    if (adds > 5 && adds <= 10) added = Math.min(added, 2)
    if (dels > 0 && dels <= 5) deleted = Math.min(deleted, 1)
    if (dels > 5 && dels <= 10) deleted = Math.min(deleted, 2)

    let total_allocated = added + deleted
    if (total_allocated > BLOCKS_FOR_COLORS) {
      if (added_raw > deleted_raw) {
        added = BLOCKS_FOR_COLORS - deleted
      } else {
        deleted = BLOCKS_FOR_COLORS - added
      }
      total_allocated = added + deleted
    }

    const neutral = Math.max(0, TOTAL_BLOCKS - total_allocated)

    return { added, deleted, neutral }
  })

  const ADD_COLOR = "var(--icon-diff-add-base)"
  const DELETE_COLOR = "var(--icon-diff-delete-base)"
  const NEUTRAL_COLOR = "var(--icon-weak-base)"

  const visibleBlocks = createMemo(() => {
    const counts = blockCounts()
    const blocks = [
      ...Array(counts.added).fill(ADD_COLOR),
      ...Array(counts.deleted).fill(DELETE_COLOR),
      ...Array(counts.neutral).fill(NEUTRAL_COLOR),
    ]
    return blocks.slice(0, 5)
  })

  return (
    <Show when={variant() === "default" ? total() > 0 : true}>
      <div data-component="diff-changes" data-variant={variant()} classList={{ [props.class ?? ""]: true }}>
        <Switch>
          <Match when={variant() === "bars"}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 12" fill="none">
              <g>
                <For each={visibleBlocks()}>
                  {(color, i) => <rect x={i() * 4} width="2" height="12" rx="1" fill={color} />}
                </For>
              </g>
            </svg>
          </Match>
          <Match when={variant() === "default"}>
            <span data-slot="diff-changes-additions">{`+${additions()}`}</span>
            <span data-slot="diff-changes-deletions">{`-${deletions()}`}</span>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
