import { createContext, useContext, type ParentProps } from "solid-js"
import type { SiteIconMode } from "../sources/experiment"

const context = createContext<{
  readonly enabled: boolean
  readonly icons: SiteIconMode
  readonly open: (from: string) => void
}>()

/**
 * Shows a turn's sources chip, which opens the turn's searches and fetches. `open` receives the ID of the user message
 * that opened the turn. Without this provider no chip shows.
 */
export function SourcesProvider(
  props: ParentProps<{ enabled: boolean; icons: SiteIconMode; onOpen: (from: string) => void }>,
) {
  return (
    <context.Provider
      value={{
        get enabled() {
          return props.enabled
        },
        get icons() {
          return props.icons
        },
        open: (from) => props.onOpen(from),
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useSources = () => useContext(context)
