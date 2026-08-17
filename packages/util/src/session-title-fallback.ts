export * as SessionTitleFallback from "./session-title-fallback.js"

const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface Info {
  readonly title?: string
  readonly parentID?: string
  readonly time: {
    readonly created: number
  }
}

/** Supplies the timestamped title required by compatibility surfaces. */
export function withTimestampedFallback(info: Info) {
  return info.title ?? fallback(info)
}

/** Supplies a compact human label and collapses historical timestamped fallbacks. */
export function displayLabel(info: Pick<Info, "title" | "parentID">) {
  if (!info.title) return info.parentID ? "Child session" : "New session"
  return info.title.match(pattern)?.[1] ?? info.title
}

/** Recognizes missing and historical root or child fallback titles. */
export function isFallbackTitle(title?: string) {
  return title === undefined || pattern.test(title)
}

/** Recognizes a missing title or the exact root fallback for this session. */
export function isExactRootFallback(info: Pick<Info, "title" | "time">) {
  return info.title === undefined || info.title === fallback({ time: info.time })
}

function fallback(info: Pick<Info, "parentID" | "time">) {
  return `${info.parentID ? "Child" : "New"} session - ${new Date(info.time.created).toISOString()}`
}
