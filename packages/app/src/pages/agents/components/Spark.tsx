import type { JSX } from "solid-js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

// self-test vectors (sparkString):
// sparkString([0, 0, 0], 3) === "···"
// sparkString([1, 2, 4], 3) === "▂▄█"
// sparkString([5], 3) === "··█"
export function sparkString(vals: number[], width = 18): string {
  const w = Number.isFinite(width) && width > 0 ? Math.trunc(width) : 18;
  const slice = Array.isArray(vals) ? vals.slice(-w) : [];
  let peak = 0;
  for (const v of slice) {
    if (Number.isFinite(v) && (v as number) > peak) peak = v as number;
  }
  const chars: string[] = [];
  if (!(peak > 0)) {
    for (let i = 0; i < slice.length; i++) chars.push("·");
  } else {
    for (const v of slice) {
      if (!Number.isFinite(v) || (v as number) <= 0) {
        chars.push("·");
        continue;
      }
      const idx = Math.min(7, Math.max(0, Math.floor(((v as number) / peak) * 7.999)));
      chars.push(BLOCKS[idx]);
    }
  }
  while (chars.length < w) chars.unshift("·");
  return chars.join("");
}

export function Spark(props: { data: number[]; live: boolean; title?: string }): JSX.Element {
  const text = () => sparkString(props.data);
  return (
    <span
      title={props.title}
      style={{
        "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        "font-size": "14px",
        "font-variant-numeric": "tabular-nums",
        "white-space": "pre",
        color: props.live ? "rgba(107,230,140,.95)" : "rgba(107,230,140,.52)",
      }}
    >
      {text()}
    </span>
  );
}
