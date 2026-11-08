import type { ServerRef } from "@opencode/plugin/gui"
import type { TerminalModel } from "./model"
import type { TerminalQuoteTarget } from "./quote"

export type TerminalProps = {
  ptyID: string
  server: ServerRef
  ghostty: TerminalModel["ghostty"]
  quote?: TerminalQuoteTarget
  autoFocus?: boolean
  onAutoFocus?: () => void
  onSubmit?: () => void
  /** The connection failed or closed; the pane shows why and stays until it unmounts. */
  onFailure?: () => void
  class?: string
}
