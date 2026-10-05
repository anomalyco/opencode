import { showToast } from "@opencode/ui/toast"

export function basename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  )
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
const units = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const

export function relativeTime(time: number, now = Date.now()) {
  const delta = time - now
  const match = units.find((item) => Math.abs(delta) >= item.ms)
  if (!match) return "now"
  return relative.format(Math.round(delta / match.ms), match.unit)
}

export function errorMessage(error: unknown) {
  // The client copies a declared server error's readable message onto the thrown Error.
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Unknown error"
}

export function toastError(title: string) {
  return (error: unknown) => {
    console.warn("[opencode-browser]", title, error)
    showToast({ variant: "error", title, description: errorMessage(error) })
  }
}
