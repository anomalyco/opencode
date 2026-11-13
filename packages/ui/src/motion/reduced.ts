const query = "(prefers-reduced-motion: reduce)"

let source: typeof matchMedia | undefined

let result: MediaQueryList | undefined

const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

function media(): MediaQueryList | undefined {
  const match = globalThis.matchMedia

  if (!match) return undefined

  if (source !== match) {
    result?.removeEventListener("change", notify)
    source = match
    result = match(query)

    if (listeners.size > 0) result.addEventListener("change", notify)
  }

  return result
}

// The app resolves its reduce motion setting into this attribute; without it the system preference applies.
function override(): boolean | undefined {
  const value = globalThis.document?.documentElement.getAttribute("data-motion")

  if (value === "reduce") return true

  if (value === "full") return false

  return undefined
}

let attribute: MutationObserver | undefined

export const prefersReducedMotion = (): boolean => override() ?? media()?.matches ?? false

/** Also settle active WAAPI jobs when the preference changes mid-animation. SSR-safe. */
export function observeReducedMotion(listener: () => void): () => void {
  const preference = media()

  if (!preference) return () => {}

  if (listeners.size === 0) {
    preference.addEventListener("change", notify)

    if (globalThis.document && globalThis.MutationObserver) {
      attribute = new MutationObserver(notify)
      attribute.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] })
    }
  }
  listeners.add(listener)

  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return
    result?.removeEventListener("change", notify)
    attribute?.disconnect()
    attribute = undefined
  }
}
