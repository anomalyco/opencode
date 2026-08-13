const DefaultFps = 60

export function resolveFps(fps = DefaultFps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps must be a positive finite number")
  return fps
}
