import { createContext, createSignal, useContext, type JSX, type ParentProps } from "solid-js"

export type SessionPanelRenderProps = {
  readonly width: number
  readonly resizing: boolean
  readonly focused: boolean
  readonly onFocusChange: (focused: boolean) => void
  readonly onFocusRequest: (focus: (() => void) | undefined) => void
  readonly close: () => void
}

type Panel = {
  readonly id: string
  readonly sessionID: string
  readonly render: (props: SessionPanelRenderProps) => JSX.Element
  readonly onUnavailable?: () => void
}

const Context = createContext<{
  readonly current: () => Panel | undefined
  readonly open: (panel: Panel) => void
  readonly close: () => void
  readonly available: (sessionID: string) => boolean
  readonly setAvailable: (sessionID: string, available: boolean) => void
}>()

export function SessionPanelProvider(props: ParentProps) {
  const [current, setCurrent] = createSignal<Panel>()
  const [availableSessionID, setAvailableSessionID] = createSignal<string>()
  return (
    <Context.Provider
      value={{
        current,
        open: setCurrent,
        close: () => setCurrent(),
        available: (sessionID) => availableSessionID() === sessionID,
        setAvailable: (sessionID, available) =>
          setAvailableSessionID((current) => (available ? sessionID : current === sessionID ? undefined : current)),
      }}
    >
      {props.children}
    </Context.Provider>
  )
}

export function useSessionPanel() {
  const value = useContext(Context)
  if (!value) throw new Error("useSessionPanel must be used within a SessionPanelProvider")
  return value
}

export function useOptionalSessionPanel() {
  return useContext(Context)
}
