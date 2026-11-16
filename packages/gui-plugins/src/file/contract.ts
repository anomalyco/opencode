import { Contract, type MountedSession } from "@opencode/plugin/gui"

/** Opens a workspace document as selectable source, without following its normal preview route. */
export const FileSource = Contract.define<{
  open(session: MountedSession, path: string): void
}, "file.source">("file.source")
