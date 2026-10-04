import { createSimpleContext } from "./helper"

export const { use: useEpilogue, provider: EpilogueProvider } = createSimpleContext({
  name: "Epilogue",
  init: (props: { set(value?: string): void }) => props.set,
})
