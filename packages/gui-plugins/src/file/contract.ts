import { Contract, type MountedSession } from "@opencode/plugin/gui"

/**
 * Opens a workspace document as selectable source, without following its normal preview route. `unprompted`: nobody
 * pressed anything to get it, as when an agent shows a file. A tab selected that way takes no input for a moment once
 * the person can see it, so a press already on its way to what the pane showed lands on nothing.
 */
export const FileSource = Contract.define<{
  open(session: MountedSession, path: string, tab?: "select" | "append", unprompted?: boolean): void
}, "file.source">("file.source")
