import type { useTheme } from "../context/theme"
import type { InboxRow } from "./inbox-data"

export function inboxStatus(theme: Pick<ReturnType<typeof useTheme>, "text">, detail: InboxRow["detail"]) {
  const feedback = theme.text.feedback
  switch (detail) {
    case "Answer question":
      return { label: `? ${detail}`, color: feedback.warning.base }
    case "Review permission":
      return { label: `! ${detail}`, color: feedback.warning.base }
    case "Working":
      return { label: detail, color: feedback.info.base }
    case "Failed":
      return { label: detail, color: feedback.error.base }
    case "Done":
      return { label: detail, color: feedback.success.base }
    case "":
      return { label: detail, color: theme.text.muted }
  }
}
