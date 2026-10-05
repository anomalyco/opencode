import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  "ui.messagePart.compaction.cancelled": "Session compaction cancelled",
  "ui.tool.shell.cancelled": "Command cancelled",
  "ui.sessionTimeline.notice.cancelled": "{{actor}} cancelled",
} satisfies Partial<Record<Keys, string>>
