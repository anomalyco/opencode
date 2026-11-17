import type { Viewport } from "./ipc"

type Size = { width: number; height: number }

type FixedViewport = Extract<Viewport, { mode: "fixed" }>

/** Fit uses the whole DIPs available to the native view. Manual scales can overflow the pane. */
export function viewportScale(viewport: FixedViewport, bounds: Size) {
  if (viewport.scale !== undefined) return viewport.scale

  return Math.min(
    1,
    Math.max(1, Math.floor(bounds.width)) / viewport.width,
    Math.max(1, Math.floor(bounds.height)) / viewport.height,
  )
}

export function viewportLayout(viewport: FixedViewport, area: Size, zoom: number) {
  const scale = viewportScale(viewport, { width: area.width * zoom, height: area.height * zoom })
  // Round up to native DIPs, then to Chromium's 1/64 CSS pixel layout unit.
  const extent = (pixels: number) => Math.ceil((Math.ceil(pixels * scale) * 64) / zoom) / 64

  return { scale, width: extent(viewport.width), height: extent(viewport.height) }
}
