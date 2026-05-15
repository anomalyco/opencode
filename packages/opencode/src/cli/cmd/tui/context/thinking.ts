import { createMemo, type Setter } from "solid-js"
import { Flag } from "@opencode-ai/core/flag/flag"
import { useKV } from "./kv"

export type ThinkingMode = "show" | "minimal" | "hide"

const MODES: readonly ThinkingMode[] = ["show", "minimal", "hide"] as const

// OpenAI's Responses API surfaces reasoning summaries that start with a bolded
// title line: "**Inspecting PR workflow**\n\n<body>". GitHub Copilot routes
// through the same shape, and the opencode provider relays it too. Pull the
// title out for a nicer label; return null for providers that don't follow
// this convention so the caller can fall back to a generic "Thinking" string.
export function reasoningTitle(text: string): string | null {
  const match = text.trimStart().match(/^\*\*([^*\n]+)\*\*/)
  return match ? match[1].trim() : null
}

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
}

// Cycle order matches the slash command: show → minimal → hide → show.
export function nextThinkingMode(current: ThinkingMode): ThinkingMode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length] ?? "show"
}

export function useThinkingMode() {
  const kv = useKV()
  // Capture pre-state before `kv.signal` seeds a default, so we can detect
  // first-time users with a legacy `thinking_visibility` boolean and migrate.
  // The KVProvider only renders children once kv.ready, so reads here are safe.
  const hadStored = kv.get("thinking_mode") !== undefined
  const legacy = kv.get("thinking_visibility")
  const [stored, setStored] = kv.signal<ThinkingMode>("thinking_mode", "minimal")

  // The kv signal exposes its setter typed as `Setter<T>` which carries Solid's
  // overload set; passing an updater fn through a property access loses the
  // bivariance trick the existing `setX((prev) => ...)` callsites rely on.
  // Wrap it in a sane shape so consumers can just call `set(next)` or pass
  // an updater.
  const set = (next: ThinkingMode | ((prev: ThinkingMode) => ThinkingMode)) => {
    if (typeof next === "function") setStored(next as Setter<ThinkingMode>)
    else setStored(() => next)
  }

  // Preserve previous experience for users who had explicitly toggled the
  // legacy `thinking_visibility` boolean. First-time users (no legacy key)
  // get the new "minimal" default.
  if (!hadStored) {
    if (legacy === true) set("show")
    else if (legacy === false) set("hide")
  }

  const mode = createMemo<ThinkingMode>(() => {
    if (Flag.OPENCODE_EXPERIMENTAL_MINIMAL_THINKING) return "minimal"
    const value = stored()
    return isThinkingMode(value) ? value : "minimal"
  })

  return {
    mode,
    set,
    locked: () => Flag.OPENCODE_EXPERIMENTAL_MINIMAL_THINKING === true,
  }
}
