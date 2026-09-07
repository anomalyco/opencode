import { createEffect, untrack, type Accessor } from "solid-js"
import type { Data } from "@opencode-ai/client/solid"

export function createSessionRetention(input: {
  session: Pick<Data["session"], "list" | "root" | "evict">
  current: Accessor<string | undefined>
  keep: Accessor<readonly string[]>
  limit: number
}) {
  let previous: string | undefined
  let recent: string[] = []
  let evicted = new Map<string, string>()

  createEffect(() => {
    const viewed = input.current()
    const current = viewed === undefined ? undefined : input.session.root(viewed)
    const keep = new Set(input.keep().map((id) => input.session.root(id)))
    // Resolve again when metadata arrives, but only navigation advances recency.
    recent = [
      ...new Set([
        ...(viewed !== previous && current !== undefined ? [current] : []),
        ...recent.map((id) => input.session.root(id)),
      ]),
    ]
    previous = viewed
    const retained = new Set([...keep, ...recent.filter((id) => !keep.has(id)).slice(0, input.limit)])
    if (current !== undefined) retained.add(current)
    recent = recent.filter((id) => retained.has(id))

    const excluded = new Map(
      input.session.list().flatMap((session) => {
        const root = input.session.root(session.id)
        return retained.has(root) ? [] : [[session.id, root] as const]
      }),
    )
    // New descendants need eviction even when their root was already evicted.
    const roots = new Set([...excluded].filter(([id, root]) => evicted.get(id) !== root).map(([, root]) => root))
    evicted = excluded
    untrack(() => roots.forEach((root) => input.session.evict(root)))
  })
}
