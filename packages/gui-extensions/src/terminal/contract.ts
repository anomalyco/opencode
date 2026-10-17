import { Contract, type MountedSession } from "../sdk"

export interface Terminal {
  /**
   * Opens a new terminal tab in the session's dock, starting in `directory` when it is given and in the session's
   * directory otherwise.
   */
  open(session: MountedSession, directory?: string): void
}

/** The terminal extension provides this. Inactive while the extension is off. */
export const Terminal = Contract.define<Terminal, "terminal">("terminal")
