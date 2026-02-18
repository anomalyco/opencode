import { createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export type AutocompleteSettings = {
  enabled: boolean
  model: string
}

export function createAutocompleteSettings() {
  const [settings, setSettings, , ready] = persisted(
    Persist.global("autocomplete-settings", ["autocomplete-settings.v1"]),
    createStore<AutocompleteSettings>({
      enabled: true,
      model: "auto",
    }),
  )
  return { settings, setSettings, ready }
}

type ModelAutocompleteInput = {
  enabled: () => boolean
  predictionModel: () => string
  getCurrentPromptText: () => string
  addPart: (part: { type: "text"; content: string; start: 0; end: 0 }) => void
}

export function createModelAutocomplete(input: ModelAutocompleteInput) {
  const [ghostText, setGhostText] = createSignal("")
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  const dismissGhost = () => {
    setGhostText("")
  }

  const cancelPending = () => {
    if (controller) {
      controller.abort()
      controller = undefined
    }
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
  }

  const acceptGhost = () => {
    const text = ghostText()
    if (!text) return
    dismissGhost()
    input.addPart({ type: "text", content: text, start: 0, end: 0 })
  }

  // NOTE: Model prediction via session.create() is intentionally disabled.
  // Using session.create() + session.prompt() causes the temporary session to appear
  // in the UI via SSE events, hijacking navigation. This requires a dedicated backend
  // completion endpoint (not session-based) to implement safely.

  const schedulePrediction = () => {
    // Disabled until a dedicated completion endpoint is available
  }

  const handleGhostKeyDown = (event: KeyboardEvent): boolean => {
    const text = ghostText()
    if (!text) return false

    if (event.key === "Tab") {
      event.preventDefault()
      acceptGhost()
      cancelPending()
      return true
    }

    // Escape and any other key dismiss ghost text (Escape still propagates)
    dismissGhost()
    cancelPending()
    return false
  }

  onCleanup(() => {
    cancelPending()
  })

  return {
    ghostText,
    acceptGhost,
    dismissGhost,
    schedulePrediction,
    handleGhostKeyDown,
  }
}
