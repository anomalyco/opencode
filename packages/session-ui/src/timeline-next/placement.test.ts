import { describe, expect, test } from "bun:test"
import { Predicate } from "effect"
import { createRoot } from "solid-js"
import type { TimelineDetail } from "../timeline/detail"
import { placementDetails, placementMessages } from "../timeline/placement-fixtures"
import { TimelineRow } from "../timeline/timeline-row"
import { createNextTimelineProjection, resolveContent } from "./projection"
import { diffOpens, placeContent } from "../timeline/place"

// Pins where the New timeline puts every part for each setting: rows, groups, what each holds, what starts open.

const messageByID = new Map(placementMessages.map((message) => [message.id, message]))

function describeRows(detail: TimelineDetail) {
  return createRoot((dispose) => {
    const projection = createNextTimelineProjection({
      sessionMessages: () => placementMessages,
      status: () => ({ type: "idle" }),
      timelineDetail: () => detail,
    })

    const rows = projection.rows().map((row) => {
      if (!Predicate.isTagged(row, "AssistantPart")) return TimelineRow.key(row)
      const refs = row.group.type === "part" ? [row.group.ref] : row.group.refs

      return `${TimelineRow.key(row)} [${row.group.type}${row.group.type === "file" && diffOpens(detail) ? " diffs open" : ""}] ${refs
        .map((ref) => {
          const content = resolveContent(messageByID.get(ref.messageID), ref.partID)

          const open = content ? placeContent(content, detail, "next").opens : false

          return `${ref.partID}${open ? "*" : ""}`
        })
        .join(", ")}`
    })

    dispose()

    return rows
  })
}

describe("New timeline placement", () => {
  test.each(Object.entries(placementDetails))("%s", (_, detail) => {
    expect(describeRows(detail)).toMatchSnapshot()
  })
})
