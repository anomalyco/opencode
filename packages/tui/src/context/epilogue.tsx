import { createSimpleContext } from "./helper"
import type { SessionEpilogue } from "../util/presentation"

// What the banner printed after the TUI closes should mention.
export type Epilogue = {
  session(value?: SessionEpilogue): void
  // The version a local update installed while the TUI was running.
  updatedVersion(version: string): void
}

export const { use: useEpilogue, provider: EpilogueProvider } = createSimpleContext({
  name: "Epilogue",
  init: (props: { value: Epilogue }) => props.value,
})
