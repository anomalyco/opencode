import { createSignal, onCleanup, onMount } from "solid-js"
import { isServer } from "solid-js/web"

export function createSeen(key: string, delay = 1000) {
  // 1. Initialize state based on storage (default to true on server to avoid flash)
  const storageKey = `app:seen:${key}`
  const [hasSeen] = createSignal(!isServer && sessionStorage.getItem(storageKey) === "true")

  onMount(() => {
    // 2. If we haven't seen it, mark it as seen for NEXT time
    if (!hasSeen()) {
      const timer = setTimeout(() => {
        sessionStorage.setItem(storageKey, "true")
      }, delay)
      onCleanup(() => clearTimeout(timer))
    }
  })

  return hasSeen
}
