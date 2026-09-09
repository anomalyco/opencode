import { createContext, type Accessor, type ParentProps, useContext } from "solid-js"

export type EmbeddedSessionView = "conversation" | "changes" | "context"

const EmbeddedSessionViewContext = createContext<{
  current: Accessor<EmbeddedSessionView>
  select: (view: EmbeddedSessionView) => void
}>()

export function EmbeddedSessionViewProvider(
  props: ParentProps<{
    current: Accessor<EmbeddedSessionView>
    onSelect: (view: EmbeddedSessionView) => void
  }>,
) {
  return (
    <EmbeddedSessionViewContext.Provider value={{ current: props.current, select: props.onSelect }}>
      {props.children}
    </EmbeddedSessionViewContext.Provider>
  )
}

export function useEmbeddedSessionView() {
  return useContext(EmbeddedSessionViewContext)
}
