import type { JSX } from "solid-js"

export const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const

export function sparkString(vals: number[], width = vals.length): string {
  const data = Array.isArray(vals) ? vals.slice(-width) : []
  const peak = Math.max(0, ...data.filter((v) => Number.isFinite(v)))
  const chars = data.map((v) => {
    if (!Number.isFinite(v) || v <= 0 || peak <= 0) return "·"
    return BLOCKS[Math.max(0, Math.min(7, Math.floor((v / peak) * 7.999)))]!
  })
  return "·".repeat(Math.max(0, width - chars.length)) + chars.join("")
}

/** Per-row bar sparkline; each call normalises to its own peak. */
export function SparkBars(props: { data: number[]; live: boolean; height?: number; title?: string }): JSX.Element {
  const height = () => props.height ?? 16
  const data = () => (Array.isArray(props.data) && props.data.length > 0 ? props.data : [0])
  const peak = () => Math.max(0, ...data())
  return (
    <span
      role="img"
      title={props.title ?? sparkString(data())}
      aria-label={props.title ?? sparkString(data())}
      class="flex items-end gap-px w-full overflow-hidden"
      style={{ height: `${height()}px` }}
    >
      {data().map((v) => (
        <span
          class="flex-1 min-w-px rounded-[1px]"
          style={{
            height: v > 0 && peak() > 0 ? `${Math.max(2, Math.round((v / peak()) * height()))}px` : "1px",
            "background-color": v > 0 ? "var(--icon-success-base)" : "var(--border-weak-base)",
            opacity: v > 0 ? (props.live ? 1 : 0.55) : 1,
          }}
        />
      ))}
    </span>
  )
}
