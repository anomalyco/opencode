import { createContext, Show, useContext, type JSX } from "solid-js"

// Named slots for MDX components (remark-slots.ts turns `<div slot="go">` into `<Slot name="go">`).
// A component renders its children inside `<SlotScope name="go">` to show only that slot's content.
// Outside any scope, a slot shows its content.
const SlotName = createContext<string>()

export function SlotScope(props: { name: string; children: JSX.Element }) {
  return <SlotName.Provider value={props.name}>{props.children}</SlotName.Provider>
}

export function Slot(props: { name: string; children: JSX.Element }) {
  const scope = useContext(SlotName)
  return <Show when={scope === undefined || scope === props.name}>{props.children}</Show>
}
