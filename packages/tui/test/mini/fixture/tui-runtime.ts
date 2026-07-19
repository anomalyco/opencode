import { resolve, type Info, type Resolved } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader_timeout?: number
  diff_style?: "auto" | "stacked"
}

export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  const { leader_timeout, diff_style, ...current } = input
  return resolve(
    {
      ...current,
      leader: leader_timeout === undefined ? undefined : { timeout: leader_timeout },
      diffs: diff_style === undefined ? current.diffs : { ...current.diffs, view: diff_style === "stacked" ? "unified" : "auto" },
    },
    { terminalSuspend: process.platform !== "win32" },
  )
}
