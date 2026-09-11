import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { SessionMessageInfo } from "@opencode/client"
import type { SessionEntry, SessionNode } from "./grouping/session"
import { use } from "./render-context"

export function entryMessageID(entry: SessionEntry) {
  if (entry.type === "part") return entry.ref.messageID
  if (entry.type === "message" || entry.type === "assistant-footer") return entry.messageID
  if (entry.type === "turn-usage") return entry.messageIDs[0]
}

export function visitEntries(
  nodes: readonly SessionNode[],
  path: readonly number[],
  visit: (entry: SessionEntry, path: readonly number[]) => void,
) {
  nodes.forEach((node, index) => {
    const position = [...path, index]
    if (node.type === "entry") visit(node.entry, position)
    if (node.type === "group") visitEntries(node.children, position, visit)
  })
}

export function useEntryAnchor(props: {
  entry: Accessor<SessionEntry | undefined>
  path: Accessor<readonly number[]>
  target: Accessor<BoxRenderable | undefined>
  message: (messageID: string) => SessionMessageInfo | undefined
}) {
  const ctx = use()
  createEffect(() => {
    const entry = props.entry()
    const target = props.target()
    const id = entry && entryMessageID(entry)
    if (!id || !target || !isBoundary(props.message(id))) return
    onCleanup(ctx.anchors.register({ messageID: id, target, path: props.path, level: props.path().length }))
  })
}

export function EntryAnchor(props: {
  entry: SessionEntry
  path: readonly number[]
  message: (messageID: string) => SessionMessageInfo | undefined
  children: JSX.Element
  marginTop?: number
}) {
  const [target, setTarget] = createSignal<BoxRenderable>()
  useEntryAnchor({ entry: () => props.entry, path: () => props.path, target, message: props.message })
  return (
    <box ref={setTarget} marginTop={props.marginTop} flexShrink={0}>
      {props.children}
    </box>
  )
}

export function GroupAnchor(props: {
  nodes: readonly SessionNode[]
  path: readonly number[]
  message: (messageID: string) => SessionMessageInfo | undefined
  reveal: () => boolean
  children: JSX.Element
}) {
  const ctx = use()
  const [target, setTarget] = createSignal<BoxRenderable>()
  createEffect(() => {
    const node = target()
    if (!node) return
    const seen = new Set<string>()
    visitEntries(props.nodes, props.path, (entry, path) => {
      const id = entryMessageID(entry)
      if (!id || seen.has(id) || !isBoundary(props.message(id))) return
      seen.add(id)
      onCleanup(
        ctx.anchors.register({
          messageID: id,
          target: node,
          path: () => path,
          level: props.path.length,
          reveal: props.reveal,
        }),
      )
    })
  })
  return (
    <box ref={setTarget} flexDirection="column" flexShrink={0}>
      {props.children}
    </box>
  )
}

function isBoundary(message: SessionMessageInfo | undefined) {
  return message?.type === "assistant" || (message?.type === "user" && !!message.text.trim())
}
