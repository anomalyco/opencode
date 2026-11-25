import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../../document"
import type { TimelineDetail } from "../../timeline/detail"
import { TimelineRow } from "../../timeline/timeline-row"
import { createNextTimelineProjection } from "../projection"
import { createNextTimelineRowRenderer } from "../row"

/** The New timeline drawing a whole session document, for stories. */
export function NextSessionTimeline(props: {
  document: SessionDocument
  timelineDetail: TimelineDetail
  turnDiffs?: boolean
}) {
  const projection = createNextTimelineProjection({
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    timelineDetail: () => props.timelineDetail,
    turnDiffs: () => props.turnDiffs ?? false,
  })

  const [disclosure, setDisclosure] = createStore<Record<string, boolean | undefined>>({})

  const renderer = createNextTimelineRowRenderer({
    sessionID: () => props.document.sessionID,
    status: () => props.document.status,
    projection,
    presentation: () => undefined,
    timelineDetail: () => props.timelineDetail,
    disclosure: {
      value: (key) => disclosure[key],
      set: (key, open) => setDisclosure(key, open),
    },
  })

  const rowKeys = createMemo(() => projection.rows().map(TimelineRow.key))

  function Row(row: { rowKey: string }) {
    const initial = projection.rowByKey().get(row.rowKey)!
    const current = createMemo(() => projection.rowByKey().get(row.rowKey) ?? initial)

    return <renderer.Row row={current} />
  }

  return (
    <div data-component="session-timeline">
      <For each={rowKeys()}>{(rowKey) => <Row rowKey={rowKey} />}</For>
    </div>
  )
}
