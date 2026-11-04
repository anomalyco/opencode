import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { SessionEntry, SessionNode } from "./grouping/session"
import { entryRef } from "./anchors"
import { use } from "./render-context"

export function visitEntries(nodes: readonly SessionNode[], visit: (entry: SessionEntry) => void) {
  nodes.forEach((node) => {
    if (node.type === "entry") visit(node.entry)
    if (node.type === "group") visitEntries(node.children, visit)
  })
}

export function useEntryAnchor(props: {
  entry: Accessor<SessionEntry | undefined>
  node: Accessor<BoxRenderable | undefined>
}) {
  const ctx = use()
  createEffect(() => {
    const entry = props.entry()
    const node = props.node()
    const ref = entry && entryRef(entry)
    if (!ref || !node) return
    onCleanup(ctx.anchors.register({ target: { type: "part", ref }, node }))
  })
}

export function EntryAnchor(props: { entry: SessionEntry; children: JSX.Element; marginTop?: number }) {
  const [node, setNode] = createSignal<BoxRenderable>()
  useEntryAnchor({ entry: () => props.entry, node })
  return (
    <box ref={setNode} marginTop={props.marginTop} flexShrink={0}>
      {props.children}
    </box>
  )
}

export function GroupAnchor(props: { groupID: string | undefined; active: boolean; children: JSX.Element }) {
  const ctx = use()
  const [node, setNode] = createSignal<BoxRenderable>()
  createEffect(() => {
    const target = node()
    const groupID = props.groupID
    if (!target || !groupID || !props.active) return
    onCleanup(ctx.anchors.register({ target: { type: "group", groupID }, node: target }))
  })
  return (
    <box ref={setNode} flexDirection="column" flexShrink={0}>
      {props.children}
    </box>
  )
}
