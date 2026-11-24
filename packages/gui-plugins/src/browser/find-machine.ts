import type { FindAction, FindView } from "./ipc"

type State =
  | { status: "closed" | "editing"; query: string }
  | { status: "searching"; query: string; id: number }
  | { status: "found"; query: string; active: number; total: number }

type Event = FindAction | { type: "issued"; id: number } | { type: "found"; result: Electron.Result }

export const initialFind: State = { status: "closed", query: "" }

/** Changing or closing the query invalidates even a final result that beats the next debounced search. */
export function transitionFind(state: State, event: Event): State {
  if (event.type === "open") return state.status === "closed" ? { status: "editing", query: state.query } : state

  if (state.status === "closed") return state

  switch (event.type) {
    case "close":
      return { status: "closed", query: state.query }
    case "query":
      return { status: "editing", query: event.query }
    case "issued":
      return { status: "searching", query: state.query, id: event.id }
    case "found":
      if (state.status !== "searching" || event.result.requestId !== state.id || !event.result.finalUpdate) return state

      return {
        status: "found",
        query: state.query,
        active: event.result.activeMatchOrdinal,
        total: event.result.matches,
      }
    default:
      return state
  }
}

export function findView(state: State): FindView | null {
  if (state.status === "closed") return null

  return { query: state.query, result: state.status === "found" ? { active: state.active, total: state.total } : null }
}
