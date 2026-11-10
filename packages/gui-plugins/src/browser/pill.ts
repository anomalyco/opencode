import { onCleanup } from "solid-js"
import { createKeyed } from "@opencode/plugin/gui"
import type { PillPresentation } from "./ipc"

function readTheme(): PillPresentation {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;background:var(--v2-background-bg-base);color:var(--v2-text-text-base);font-family:var(--v2-font-family-sans);border:1px solid var(--v2-border-border-muted)"
  document.body.appendChild(probe)
  const text = getComputedStyle(probe)
  const background = text.backgroundColor
  const border = text.borderTopColor
  const color = text.color
  const font = getComputedStyle(document.body).fontFamily || text.fontFamily

  probe.style.color = "var(--v2-text-text-muted)"
  const muted = getComputedStyle(probe).color

  probe.remove()

  return { label: "", background, border, color, muted, font }
}

/**
 * Feeds the small native connection-pill view its translated label and resolved app theme. The view itself is laid
 * out by the host embed, so this only runs when visibility, language or appearance changes.
 */
export function createPillPresentation(input: {
  readonly visible: () => boolean
  readonly label: () => string
  readonly owner: () => string | undefined
  readonly send: (pill: PillPresentation) => void
}) {
  let lastVisible = false
  let lastKey = ""

  const emit = () => {
    if (!input.visible()) {
      lastVisible = false

      return
    }

    const theme = readTheme()
    const presentation = { ...theme, label: input.label() }
    const key = `${input.owner() ?? ""}\n${JSON.stringify(presentation)}`

    if (lastVisible && key === lastKey) return
    lastVisible = true
    lastKey = key
    input.send(presentation)
  }

  createKeyed(
    () => ({ visible: input.visible(), label: input.label(), owner: input.owner() }),
    emit,
    {
      equals: (previous, next) =>
        previous.visible === next.visible && previous.label === next.label && previous.owner === next.owner,
    },
  )
  const theme = new MutationObserver(emit)
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-scheme", "style"],
  })
  onCleanup(() => {
    theme.disconnect()
  })
}
