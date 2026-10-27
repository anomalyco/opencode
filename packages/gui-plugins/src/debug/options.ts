/**
 * Builds with the debug tools: the dev server, as for the debug bar's Motion tools. Packaged builds never run memory
 * diagnostics or open a debugging port, whatever the environment says.
 */
export function debugBuild(build: { readonly packaged: boolean; readonly channel: string }) {
  return !build.packaged
}

/** Invalid values disable diagnostics rather than turning a bad interval into a hot timer. */
export function memoryLogInterval(value: string | undefined) {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return undefined
  const seconds = Number(value)

  return seconds >= 1 && seconds <= 2_147_483 ? seconds * 1000 : undefined
}
