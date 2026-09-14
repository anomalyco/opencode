import type { JSX } from "solid-js";

export type PulseKind = "working" | "permission" | "error" | "unseen" | "idle";

const COLORS: Record<Exclude<PulseKind, "idle">, string> = {
  working: "#4ade80",
  permission: "#fbbf24",
  error: "#f87171",
  unseen: "#4da3ff",
};

export function Pulse(props: { kind: PulseKind; animate?: boolean }): JSX.Element {
  if (props.kind === "idle") {
    return (
      <span
        style={{
          color: "rgba(148,163,184,.55)",
          "font-size": "14px",
          "line-height": "1",
        }}
      >
        ·
      </span>
    );
  }
  const color = COLORS[props.kind];
  const spinning = props.kind === "working" && props.animate !== false;
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        "border-radius": "9999px",
        "background-color": color,
        animation: spinning ? "agents-pulse-blink 1.2s ease-in-out infinite" : undefined,
      }}
    />
  );
  return (
    <>
      {spinning ? (
        <style>{`@keyframes agents-pulse-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
      ) : null}
      {dot}
    </>
  );
}
