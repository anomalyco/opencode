import { createMemo, type ParentProps } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import "./composer-lane.css"

/** Where the floating pills above the composer sit, in logical terms, following the background activity setting. */
export function useComposerLaneAlignment() {
  const language = useLanguage()
  const settings = useSettings()

  return createMemo(() => {
    const value = settings.general.backgroundActivity()

    if (value === "center") return "center"

    // Left/right are physical positions; Kobalte and flex alignment use logical start/end.
    return (value === "right") === (language.direction() === "rtl") ? "start" : "end"
  })
}

/** Where a pill's popover opens: above it, from the lane's aligned edge. */
export function composerLanePlacement(alignment: "center" | "start" | "end") {
  return ({ center: "top", start: "top-start", end: "top-end" } as const)[alignment]
}

// The pills float out of flow in a lane the timeline reserves at its tail, so coming and going never resizes the
// composer region or moves the timeline. Every pill shares the lane's one row.
export function SessionComposerLane(props: ParentProps) {
  const alignment = useComposerLaneAlignment()

  return (
    <div
      data-component="session-composer-lane"
      data-alignment={alignment()}
      class="pointer-events-none absolute inset-x-0 bottom-full flex items-end gap-2 pb-2.5"
      classList={{
        "justify-start": alignment() === "start",
        "justify-center": alignment() === "center",
        "justify-end": alignment() === "end",
      }}
    >
      {props.children}
    </div>
  )
}
