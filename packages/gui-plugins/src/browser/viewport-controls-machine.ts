import type { Viewport } from "./ipc"
import type { Device } from "./viewport-presets"

type Dimensions = { width: string; height: string }

type Fixed = Extract<Viewport, { mode: "fixed" }>

type Context = { viewport?: Viewport; autoWidth: number; autoHeight: number; zoomed: boolean }

export type ViewportControlsState =
  | ({ attempt: number; draft?: Dimensions } & (
      | { status: "ready" }
      | { status: "applying"; viewport: Viewport }
      | { status: "applied"; viewport: Viewport; report: Viewport | undefined }
      | { status: "failed" }
    ))
  | { status: "disposed" }

export type ViewportAction =
  | { type: "edited"; axis: keyof Dimensions; value: string }
  | { type: "rotated" }
  | { type: "preset.selected"; device?: Device }
  | { type: "scale.selected"; scale?: Fixed["scale"] }

export type ViewportControlsEvent =
  | (ViewportAction & { context: Context })
  | { type: "blurred" }
  | { type: "succeeded"; attempt: number; report: Viewport | undefined }
  | { type: "failed" | "timeout"; attempt: number }
  | { type: "disposed" }

type Transition = { state: ViewportControlsState; apply?: { attempt: number; viewport: Viewport } }

export const initialViewportControls: ViewportControlsState = { status: "ready", attempt: 0 }

export function validDimension(value: string) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4096
}

function invalidFields(fields: Dimensions) {
  return !validDimension(fields.width) || !validDimension(fields.height)
}

export function viewportControlsView(state: ViewportControlsState, context: Context) {
  // A scale change or rotation can follow an edit before its native size reaches the window.
  const optimistic = state.status === "applying" || (state.status === "applied" && state.report === context.viewport)
  const viewport = optimistic && !context.zoomed ? state.viewport : context.viewport
  const fixed = viewport?.mode === "fixed" ? viewport : undefined
  const draft = state.status === "disposed" ? undefined : state.draft

  const fields = draft ?? {
    width: String(fixed?.width ?? context.autoWidth),
    height: String(fixed?.height ?? context.autoHeight),
  }

  const invalid = invalidFields(fields)

  return { fixed, fields, invalid, error: state.status === "failed" && !invalid }
}

export function transitionViewportControls(state: ViewportControlsState, event: ViewportControlsEvent): Transition {
  if (state.status === "disposed") return { state }

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" } }
    case "blurred":
      return state.draft ? { state: { ...state, draft: undefined } } : { state }
    case "succeeded":
      if (state.status !== "applying" || state.attempt !== event.attempt) return { state }

      return { state: { ...state, status: "applied", report: event.report } }
    case "failed":
    case "timeout": {
      // A successful reply can precede the page report. Stop holding the requested size if no report follows.
      if (event.type === "timeout" && state.status === "applied" && event.attempt === state.attempt)
        return { state: { status: "ready", attempt: state.attempt, draft: state.draft } }

      if (state.status !== "applying" || state.attempt !== event.attempt) return { state }
      const { draft, attempt } = state

      return { state: { status: draft && invalidFields(draft) ? "ready" : "failed", draft, attempt } }
    }
  }

  if (event.context.zoomed) return { state }
  const { fixed, fields, invalid } = viewportControlsView(state, event.context)
  const scale = fixed?.scale
  const attempt = state.attempt + 1

  const apply = (viewport: Viewport, draft?: Dimensions): Transition => ({
    state: { status: "applying", attempt, viewport, draft },
    apply: { attempt, viewport },
  })

  switch (event.type) {
    case "edited": {
      const draft = { ...fields, [event.axis]: event.value }

      if (invalidFields(draft)) {
        if (state.status === "failed") return { state: { status: "ready", attempt: state.attempt, draft } }

        return { state: { ...state, draft } }
      }

      return apply({ mode: "fixed", width: Number(draft.width), height: Number(draft.height), scale }, draft)
    }

    case "rotated":
      if (invalid) return { state }

      return apply({ mode: "fixed", ...fixed, width: Number(fields.height), height: Number(fields.width) })
    case "preset.selected": {
      const device = event.device

      return apply(
        device
          ? { mode: "fixed", width: device.width, height: device.height, preset: device.id, scale }
          : { mode: "auto" },
      )
    }

    case "scale.selected":
      if (!fixed && event.scale === undefined) return { state }

      return apply({
        mode: "fixed",
        width: event.context.autoWidth,
        height: event.context.autoHeight,
        ...fixed,
        scale: event.scale,
      })
  }
}
