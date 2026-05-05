import { createContext, useContext } from "solid-js"
import type { Accessor } from "solid-js"

export type PlatformInfo = {
  platform: "web" | "desktop"
}

const ctx = createContext<Accessor<PlatformInfo>>()

export function PlatformProvider(props: { value: Accessor<PlatformInfo>; children: any }) {
  return ctx.Provider({ value: props.value, children: props.children })
}

export function usePlatform(): PlatformInfo {
  const ctxValue = useContext(ctx)
  if (!ctxValue) return { platform: "web" }
  return ctxValue()
}