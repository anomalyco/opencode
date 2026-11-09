import { onCleanup } from "solid-js"
import { createKeyed } from "@opencode/plugin/gui"
import type { PillOverlay, PillPresentation } from "./ipc"

function readTheme(): PillPresentation {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;background:var(--v2-background-bg-base);color:var(--v2-text-text-base);font-family:var(--v2-font-family-sans);border:1px solid var(--v2-border-border-muted)"
  document.body.appendChild(probe)
  const text = getComputedStyle(probe)

  probe.style.color = "var(--v2-text-text-muted)"

  const theme = {
    label: "",
    background: text.backgroundColor,
    border: text.borderTopColor,
    color: text.color,
    muted: getComputedStyle(probe).color,
    font: getComputedStyle(document.body).fontFamily || text.fontFamily,
  }

  probe.remove()

  return theme
}

/**
 * Feeds the small native connection-pill view its translated label and resolved app theme. The view itself is laid
 * out by the host embed, so this only runs when visibility, language or appearance changes.
 */
export function createPillPresentation(input: {
  readonly visible: () => boolean
  readonly label: () => string
  readonly mode: () => "light" | "dark"
  readonly send: (pill: PillOverlay) => void
}) {
  let lastVisible: boolean | undefined
  let lastKey = ""

  const emit = () => {
    if (!input.visible()) {
      if (lastVisible !== false) input.send({ visible: false })
      lastVisible = false

      return
    }

    const theme = readTheme()
    const presentation = { ...theme, label: input.label() }
    const key = JSON.stringify(presentation)

    if (lastVisible === true && key === lastKey) return
    lastVisible = true
    lastKey = key
    input.send({ visible: true, presentation })
  }

  createKeyed(
    () => ({ visible: input.visible(), label: input.label(), mode: input.mode() }),
    emit,
    {
      equals: (previous, next) =>
        previous.visible === next.visible && previous.label === next.label && previous.mode === next.mode,
    },
  )
  const theme = new MutationObserver(emit)
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-scheme", "style"],
  })
  onCleanup(() => {
    theme.disconnect()
    input.send({ visible: false })
  })
}
