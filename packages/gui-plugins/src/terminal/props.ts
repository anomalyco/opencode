import type { Pty } from "./pty"
import type { TerminalModel } from "./model"
import type { TerminalQuoteTarget } from "./quote"

export type TerminalProps = {
  pty: Pty
  ghostty: TerminalModel["ghostty"]
  quote?: TerminalQuoteTarget
  autoFocus?: boolean
  onAutoFocus?: () => void
  onSubmit?: () => void
  /** The connection failed or closed; the pane shows why and stays until it unmounts. */
  onFailure?: () => void
  class?: string
}
