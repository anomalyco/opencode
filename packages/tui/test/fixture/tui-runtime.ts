import { resolve, type Info, type Resolved } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader?: { timeout?: number }
}

export function createTuiResolvedConfig(input: ResolvedInput = {}, options?: { terminal?: boolean }) {
  const config = resolve(input, { terminalSuspend: process.platform !== "win32", environment: {} })
  return {
    ...config,
    session: { ...config.session, terminal: options?.terminal ?? config.session.terminal },
  }
}
