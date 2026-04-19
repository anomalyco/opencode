import { createSignal } from "solid-js"

const [promptEnabled_, _setPromptEnabled] = createSignal(false)

export const promptEnabled = () => false

const [probe, setProbe] = createSignal<any>(undefined)
export const promptProbe = {
  select: (_id: string) => {},
  set: (_value: any) => {},
  clear: () => setProbe(undefined),
}
