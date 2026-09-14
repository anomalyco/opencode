import type { JSX } from "solid-js"
import type { FleetKind } from "../fleetTypes"

const COLORS: Record<FleetKind, string> = {
  working: "var(--icon-success-base)",
  permission: "var(--icon-warning-base)",
  error: "var(--icon-critical-base)",
  unseen: "var(--icon-info-base)",
  idle: "var(--icon-weak-base)",
}

export function Pulse(props: { kind: FleetKind }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="inline-block size-2 rounded-full shrink-0"
      classList={{ "animate-pulse": props.kind === "working", "opacity-50": props.kind === "idle" }}
      style={{ "background-color": COLORS[props.kind] }}
    />
  )
}
