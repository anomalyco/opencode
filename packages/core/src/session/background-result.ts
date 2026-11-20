export * as BackgroundResult from "./background-result.js"

type Kind = "shell" | "subagent" | "codemode" | "image" | "video"

/** A status sentence followed by the labeled payload, with reserved tags escaped in both. */
export function render(kind: Kind, status: string, payload?: { readonly label: string; readonly text: string }) {
  const body = payload ? `${status}\n${payload.label}:\n${payload.text}` : status
  return `<background-result kind="${kind}">\n${body.replace(/<(?=\s*\/?\s*(?:background-result|system-update))/gi, "&lt;")}\n</background-result>`
}

/** How a background job's state reads in the status sentence. */
export function outcome(state: string) {
  if (state === "error") return "failed"
  if (state === "cancelled") return "was cancelled"
  if (state === "running") return "reported while its own background work is still running"
  return "finished"
}
