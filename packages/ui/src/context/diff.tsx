import { createContext, useContext, type ParentProps, type ValidComponent } from "solid-js"

const DiffComponentContext = createContext<ValidComponent>()

export function DiffComponentProvider(props: ParentProps<{ component: ValidComponent }>) {
  return <DiffComponentContext.Provider value={props.component}>{props.children}</DiffComponentContext.Provider>
}

export function useDiffComponent() {
  const component = useContext(DiffComponentContext)
  if (!component) throw new Error("DiffComponentProvider must be used to provide a diff component")
  return component
}
