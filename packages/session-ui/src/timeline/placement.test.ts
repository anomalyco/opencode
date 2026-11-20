import { describe, expect, test } from "bun:test"
import { Predicate } from "effect"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import type { TimelineDetail } from "./detail"
import { placeContent } from "./place"
import { openMark, placementDetails, placementMessages } from "./placement-fixtures"
import { Timeline, TimelineRow } from "./projection"

// Pins where the current timeline puts every part for each setting: rows, groups, what each holds, and, where a row or
// activity group opens each part on its own, whether it starts open (`*`), closed (`-`) or as the row decides.

const messageByID = new Map(placementMessages.map((message) => [message.id, message]))

function mark(item: SessionMessageAssistant["content"][number] | undefined, detail: TimelineDetail) {
  const open = item ? placeContent(item, detail, "current").opens : undefined

  return openMark(open)
}

function describeRows(detail: TimelineDetail) {
  const result = Timeline.constructSessionMessageRows(
    placementMessages,
    true,
    { type: "idle" },
    undefined,
    detail.shell.details === "expanded",
    detail.edit.details === "expanded",
    undefined,
    detail,
  )

  return result.rows.map((row) => {
    if (!Predicate.isTagged(row, "AssistantPart")) return TimelineRow.key(row)
    const refs = row.group.type === "part" ? [row.group.ref] : row.group.refs

    return `${TimelineRow.key(row)} [${row.group.type}] ${refs
      .map((ref) => {
        const content = Timeline.resolveContent(messageByID.get(ref.messageID), ref.partID)

        return row.group.type === "part" || row.group.type === "context"
          ? ref.partID + mark(content, detail)
          : ref.partID
      })
      .join(", ")}`
  })
}

describe("current timeline placement", () => {
  test.each(Object.entries(placementDetails))("%s", (_, detail) => {
    expect(describeRows(detail)).toMatchSnapshot()
  })
})
