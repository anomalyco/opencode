import { useSyncExternalStore } from "react"
import { useColorScheme as useRNColorScheme } from "react-native"

function subscribe() {
  return () => {}
}

function getSnapshot() {
  return true
}

function getServerSnapshot() {
  return false
}

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const colorScheme = useRNColorScheme()

  if (hasHydrated) {
    return colorScheme
  }

  return "light"
}
