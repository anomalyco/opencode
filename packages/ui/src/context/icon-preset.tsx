import { createSimpleContext } from "./helper"

export type IconPreset = "sharp" | "soft"

export const { use: useIconPreset, provider: IconPresetProvider } = createSimpleContext({
  name: "IconPreset",
  init: (props: { value: () => IconPreset }) => props.value,
  gate: false,
})
