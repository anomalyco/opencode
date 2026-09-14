import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import type { SessionUserActions } from "../actions"
import { createReactiveTimelineProjection, TimelineRow, type ReasoningMode } from "./projection"
import { createSessionTimelineRowRenderer, type SessionUserPresentation } from "./session-timeline-row"

export type { SessionUserPresentation } from "./session-timeline-row"

export type SessionTimelineProps = {
  document: SessionDocument
  presentation?: Record<string, SessionUserPresentation | undefined>
  actions?: SessionUserActions
  reasoningMode?: ReasoningMode
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  class?: string
}

export function SessionTimeline(props: SessionTimelineProps) {
  const projection = createReactiveTimelineProjection({
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    reasoningMode: () => props.reasoningMode ?? "compact",
    shellToolDefaultOpen: () => props.shellToolDefaultOpen ?? false,
    editToolDefaultOpen: () => props.editToolDefaultOpen ?? false,
  })
  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>({})
  const renderer = createSessionTimelineRowRenderer({
    sessionID: () => props.document.sessionID,
    status: () => props.document.status,
    projection,
    presentation: (message) => props.presentation?.[message.id],
    actions: props.actions,
    reasoningMode: () => props.reasoningMode ?? "compact",
    shellToolDefaultOpen: () => props.shellToolDefaultOpen ?? false,
    editToolDefaultOpen: () => props.editToolDefaultOpen ?? false,
    disclosure: {
      value: (key) => toolOpen[key],
      set: (key, open) => setToolOpen(key, open),
    },
  })
  const rowKeys = createMemo(() => projection.rows().map(TimelineRow.key))

  function Row(props: { rowKey: string }) {
    const initial = projection.rowByKey().get(props.rowKey)!
    const row = createMemo(() => projection.rowByKey().get(props.rowKey) ?? initial)
    return <renderer.Row row={row} />
  }

  return (
    <div data-component="session-timeline" class={props.class}>
      <For each={rowKeys()}>{(rowKey) => <Row rowKey={rowKey} />}</For>
    </div>
  )
}
