import type { Locale } from "../i18n/translate"
import { createSimpleContext } from "./helper"
import type { SessionEpilogue } from "../util/presentation"

// What the banner printed after the TUI closes should mention.
export type Epilogue = {
  session(value?: SessionEpilogue, locale?: Locale): void
  // The version a local update installed while the TUI was running.
  updatedVersion(version: string): void
}

export const { use: useEpilogue, provider: EpilogueProvider } = createSimpleContext({
  name: "Epilogue",
  init: (props: { value: Epilogue }) => props.value,
})
