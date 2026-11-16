import type { SessionTab, Tab } from "./tabs"

export type PreviewState = { readonly status: "idle" } | { readonly status: "previewing"; readonly tab: SessionTab }

export type PreviewEvent =
  | { readonly type: "open"; readonly tab: SessionTab }
  | { readonly type: "release" }
  | { readonly type: "activate"; readonly tab: Tab }
  | { readonly type: "keep"; readonly tab: SessionTab }
  | { readonly type: "route"; readonly sessionId: string; readonly parentId?: string }

export const INITIAL_PREVIEW_STATE: PreviewState = Object.freeze({ status: "idle" })

export function transitionPreview(state: PreviewState, event: PreviewEvent): PreviewState {
  if (event.type === "open") {
    if (matchesPreview(state, event.tab)) return state

    return { status: "previewing", tab: event.tab }
  }

  if (state.status === "idle") return state

  if (event.type === "release") return INITIAL_PREVIEW_STATE

  if (event.type === "activate") return matchesPreview(state, event.tab) ? state : INITIAL_PREVIEW_STATE

  if (event.type === "keep") return matchesPreview(state, event.tab) ? INITIAL_PREVIEW_STATE : state

  const routeSessionId = event.sessionId === state.tab.sessionId ? undefined : event.sessionId

  const routeParentId = event.sessionId === state.tab.sessionId ? undefined : event.parentId

  if (state.tab.routeSessionId === routeSessionId && state.tab.routeParentId === routeParentId) return state

  return { status: "previewing", tab: { ...state.tab, routeSessionId, routeParentId } }
}

export function currentPreview(state: PreviewState) {
  return state.status === "previewing" ? state.tab : undefined
}

export function matchesPreview(state: PreviewState, tab: Pick<SessionTab, "server" | "sessionId"> | Tab) {
  const current = currentPreview(state)

  return !!current && "sessionId" in tab && current.server === tab.server && current.sessionId === tab.sessionId
}
