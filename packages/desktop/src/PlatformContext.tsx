import { createContext } from "solid-js"
import { useContext } from "solid-js"

export interface Platform {}

const PlatformContext = createContext<Platform>()

export const PlatformProvider = PlatformContext.Provider

export function usePlatform() {
  const ctx = useContext(PlatformContext)
  if (!ctx) throw new Error("usePlatform must be used within a PlatformProvider")
  return ctx
}
