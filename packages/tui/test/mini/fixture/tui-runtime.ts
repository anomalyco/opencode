import { resolve, type Info, type Resolved } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader_timeout?: number
}

export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  const { leader_timeout, ...current } = input
  return resolve(
    {
      ...current,
      leader: leader_timeout === undefined ? undefined : { timeout: leader_timeout },
    },
    { terminalSuspend: process.platform !== "win32" },
  )
}
