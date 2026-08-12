import type { Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

// workerd cannot spawn processes; the Pty service surfaces this as a defect if
// a terminal is ever requested on this runtime.
export function spawn(): Proc {
  throw new Error("Pseudo-terminals are unavailable on the workerd runtime")
}
