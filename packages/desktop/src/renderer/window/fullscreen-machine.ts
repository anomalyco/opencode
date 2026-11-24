// `seeded` turns on with the first answer or main event, so a late boot read cannot overwrite a newer event.
export type FullscreenState =
  | { readonly status: "unseeded" }
  | { readonly status: "seeded"; readonly fullscreen: boolean }

export type FullscreenEvent =
  | { readonly type: "fullscreen.seeded"; readonly fullscreen: boolean }
  | { readonly type: "fullscreen.seed-failed" }
  | { readonly type: "fullscreen.changed"; readonly fullscreen: boolean }

const UNSEEDED: FullscreenState = Object.freeze({ status: "unseeded" })

const WINDOWED: FullscreenState = Object.freeze({ status: "seeded", fullscreen: false })

const FULLSCREEN: FullscreenState = Object.freeze({ status: "seeded", fullscreen: true })

export function createFullscreenState() {
  return UNSEEDED
}

export function transitionFullscreen(state: FullscreenState, event: FullscreenEvent): FullscreenState {
  if (event.type === "fullscreen.changed") return event.fullscreen ? FULLSCREEN : WINDOWED

  if (state.status === "seeded") return state

  // A window whose state main could not report is drawn windowed, as before the first answer.
  if (event.type === "fullscreen.seed-failed") return WINDOWED

  return event.fullscreen ? FULLSCREEN : WINDOWED
}

export function selectWindowFullscreen(state: FullscreenState) {
  return state.status === "seeded" && state.fullscreen
}
