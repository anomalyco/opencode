export * as SystemNotice from "./system-notice.js"

/**
 * An update from OpenCode, such as background work finishing, as the model sees it: one `<system-notice>` block with
 * a status sentence, then the labeled payload. The system prompt says these are information, not instructions, and
 * never something the model writes. Text inside can't close the block or open another.
 */
export function render(status: string, payload?: { readonly label: string; readonly text: string }) {
  const body = payload ? `${status}\n${payload.label}:\n${payload.text}` : status
  return `<system-notice>\n${body.replace(/<(?=\s*\/?\s*system-notice)/gi, "&lt;")}\n</system-notice>`
}

/** How a background job's state reads in a notice's status sentence. */
export function outcome(state: string) {
  if (state === "error") return "failed"
  if (state === "cancelled") return "was cancelled"
  if (state === "running") return "reported while its own background work is still running"
  return "finished"
}
