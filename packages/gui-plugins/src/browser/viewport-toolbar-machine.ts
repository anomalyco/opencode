import type { Browser } from "@opencode/plugin-browser/rpc"
import type { PageEvent } from "./connection"

type Target = { sessionKey: string; tabID: Browser.TabID }

type Context = { target: Target | undefined; available: boolean; page: PageEvent | undefined }

export type ViewportToolbarState =
  | { status: "following"; attempt: number; dismissed?: PageEvent }
  | { status: "toggling" | "selected"; attempt: number; target: Target; open: boolean; dismissed?: PageEvent }
  | { status: "disposed" }

export type ViewportToolbarEvent =
  | { type: "toggled" | "notice.dismissed"; context: Context }
  | { type: "succeeded"; attempt: number }
  | { type: "failed" | "timeout"; attempt: number; context: Context }
  | { type: "disposed" }

type Effect = { type: "toggle"; attempt: number; target: Target; open: boolean } | { type: "notify-failed" }

type Transition = { state: ViewportToolbarState; effect?: Effect }

export const initialViewportToolbar: ViewportToolbarState = { status: "following", attempt: 0 }

export function viewportToolbarView(state: ViewportToolbarState, context: Context) {
  if (state.status === "disposed") return { visible: false, notice: undefined }
  const fixed = context.page?.viewport.mode === "fixed"

  const selected =
    state.status !== "following" && state.target.sessionKey === context.target?.sessionKey ? state : undefined

  // A close hides the controls immediately, while the page still reports its old fixed size.
  const open = selected && selected.target.tabID === context.target?.tabID ? selected.open : fixed || !!selected?.open

  const notice = state.dismissed !== context.page ? context.page?.viewportNotice : undefined

  return { visible: context.available && !!context.target && open, notice }
}

export function transitionViewportToolbar(state: ViewportToolbarState, event: ViewportToolbarEvent): Transition {
  if (state.status === "disposed") return { state }

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" } }
    case "notice.dismissed":
      if (!viewportToolbarView(state, event.context).notice) return { state }

      return { state: { ...state, dismissed: event.context.page } }
    case "toggled": {
      const { target, available, page } = event.context

      if (!available || !target) return { state }
      const view = viewportToolbarView(state, event.context)
      const open = !view.visible
      const attempt = state.attempt + 1

      return {
        state: {
          status: "toggling",
          target,
          attempt,
          open,
          dismissed: view.visible && view.notice ? page : state.dismissed,
        },
        effect: { type: "toggle", target, attempt, open },
      }
    }

    case "succeeded":
    case "failed":
    case "timeout": {
      if (state.status !== "toggling" || state.attempt !== event.attempt) return { state }

      if (event.type === "succeeded") return { state: { ...state, status: "selected" } }
      const current = state.target === event.context.target && event.context.available
      const reopen = current && event.type === "failed" && event.context.page?.viewport.mode === "fixed"

      return {
        state:
          state.open || reopen
            ? { ...state, status: "selected", open: true }
            : { status: "following", attempt: state.attempt, dismissed: state.dismissed },
        effect: current ? { type: "notify-failed" } : undefined,
      }
    }
  }
}
