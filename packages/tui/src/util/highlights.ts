import type { Storage } from "../context/storage"

export type HighlightsInput = {
  readonly version: string
  /** Number of highlights embedded in this build. */
  readonly count: number
  /** Whether this user has used the TUI before, so a first run with no state is still an update. */
  readonly history: boolean
}

type State = { seen?: string }

/**
 * Decides what to do with the current release's highlights: `show` opens the dialog and records the version,
 * `record` marks a version seen silently, and `none` leaves the state untouched. Only stable versions count.
 */
export function decide(input: HighlightsInput & { readonly seen?: string }) {
  const current = stable(input.version)
  if (!current) return "none"
  const seen = input.seen === undefined ? undefined : stable(input.seen)
  if (!seen && !input.history) return "record"
  if (seen && !newer(current, seen)) return "none"
  return input.count > 0 ? "show" : "record"
}

/**
 * Applies the decision inside the locked storage update, so only one of several TUIs starting together shows the
 * dialog. Resolves to whether this TUI should show it.
 */
export async function claim(storage: Storage, input: HighlightsInput) {
  const [state, update] = storage.store<State>("highlights", { initial: {} })
  if (decide({ ...input, seen: state.seen }) === "none") return false
  const result = { action: "none" as ReturnType<typeof decide> }
  await update((draft) => {
    result.action = decide({ ...input, seen: draft.seen })
    if (result.action !== "none") draft.seen = input.version
  })
  return result.action === "show"
}

function stable(version: string) {
  return version
    .match(/^(\d+)\.(\d+)\.(\d+)$/)
    ?.slice(1)
    .map(Number)
}

function newer(current: number[], seen: number[]) {
  const index = current.findIndex((part, index) => part !== seen[index])
  return index !== -1 && current[index] > seen[index]
}
