export function shouldShowDebugBar(input: {
  dev: boolean
  search: string
  read?: () => string | null
  write?: (value: string) => void
}) {
  if (input.dev) return true
  const flag = new URLSearchParams(input.search).get("debug_perf")
  if (flag === "1") {
    input.write?.("1")
    return true
  }
  return input.read?.() === "1"
}
