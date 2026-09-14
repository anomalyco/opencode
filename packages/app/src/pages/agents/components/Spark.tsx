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

export function SparkBars(props: { data: number[]; live: boolean; height?: number; title?: string }): JSX.Element {
  const height = () => props.height ?? 32;
  const data = () => (Array.isArray(props.data) && props.data.length > 0 ? props.data : new Array(64).fill(0));
  const hi = () => Math.max(...data());
  const level = (v: number) => (hi() > 0 ? Math.max(0, Math.min(7, Math.floor((v / hi()) * 7.999))) / 7 : 0);
  return (
    <span
      role="img"
      title={props.title ?? sparkString(data())}
      aria-label={props.title ?? sparkString(data())}
      style={{
        display: "flex",
        "align-items": "flex-end",
        gap: "1px",
        width: "100%",
        height: `${height()}px`,
        overflow: "hidden",
      }}
    >
      {data().map((v) => {
        const h = v > 0 ? Math.max(3, Math.round(2 + level(v) * (height() - 2))) : 2;
        return (
          <span
            style={{
              flex: "1 1 0",
              "min-width": "2px",
              height: `${h}px`,
              "border-radius": "1px",
              background: props.live ? "rgba(107,230,140,.95)" : "rgba(107,230,140,.52)",
              opacity: v > 0 ? 1 : 0.28,
              "align-self": "flex-end",
            }}
          />
        );
      })}
    </span>
  );
}
