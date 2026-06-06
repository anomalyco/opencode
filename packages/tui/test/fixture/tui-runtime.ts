import { resolve, type Info, type Resolved } from "../../src/config"
import { TuiKeybind } from "../../src/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader_timeout"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader_timeout?: number
}

export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  return resolve(input, { terminalSuspend: process.platform !== "win32" })
}
