import { resolve, type Info, type Resolved } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader?: { timeout?: number }
}

// Tests were written for the previous designs and theme, so they keep new designs off and use
// opencode-classic unless they choose otherwise.
export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  return resolve(
    {
      ...input,
      experimental: { "new-designs": false, ...input.experimental },
      theme: { name: "opencode-classic", ...input.theme },
      // Existing tests were written against the upstream appearance and exact theme colors; fork visuals and
      // the 256-color fallback opt in explicitly.
      ui: { style: "opencode", color_depth: "truecolor", ...input.ui },
    },
    { terminalSuspend: process.platform !== "win32", environment: {} },
  )
}
