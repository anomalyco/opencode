/** @jsxImportSource @opentui/solid */
import {
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  type TuiPaths,
} from "../../src/context/runtime"
import { ExitProvider, type Exit } from "../../src/context/exit"
import type { ParentProps } from "solid-js"

export function TestTuiContexts(
  props: ParentProps<{
    cwd?: string
    directory?: string
    paths?: Partial<TuiPaths>
    exit?: Exit
  }>,
) {
  return (
    <TuiPathsProvider
      value={{
        cwd: props.cwd ?? props.directory ?? "/tmp/opencode/packages/tui",
        home: "/tmp/opencode/home",
        state: "/tmp/opencode/state",
        worktree: "/tmp/opencode",
        ...props.paths,
      }}
    >
      <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
        <TuiStartupProvider value={{ skipInitialLoading: false }}>
          <ExitProvider exit={props.exit ?? (() => {})}>{props.children}</ExitProvider>
        </TuiStartupProvider>
      </TuiTerminalEnvironmentProvider>
    </TuiPathsProvider>
  )
}
