import { createContext, useContext, type ParentProps } from "solid-js"

type Mode = "dark" | "light"

const ModeContext = createContext<Mode>()

export function ModeProvider(props: ParentProps<{ mode: Mode }>) {
  return <ModeContext.Provider value={props.mode}>{props.children}</ModeContext.Provider>
}

export function useMode() {
  const mode = useContext(ModeContext)
  if (!mode) throw new Error("ModeProvider context must be used within a ModeProvider")
  return mode
}
