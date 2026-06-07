/** @jsxImportSource @opentui/solid */
import { createTuiEnvironment, TuiEnvironmentProvider, type TuiEnvironment } from "@opencode-ai/tui/runtime"
import type { ParentProps } from "solid-js"

export function TestTuiEnvironmentProvider(
  props: ParentProps<{
    cwd?: string
    directory?: string
    paths?: Partial<TuiEnvironment["paths"]>
    capabilities?: Partial<TuiEnvironment["capabilities"]>
    editor?: Partial<TuiEnvironment["editor"]>
  }>,
) {
  return (
    <TuiEnvironmentProvider
      value={createTuiEnvironment({
        cwd: props.cwd ?? props.directory ?? "/tmp/opencode/packages/opencode",
        platform: "linux",
        paths: {
          home: "/tmp/opencode/home",
          state: "/tmp/opencode/state",
          worktree: "/tmp/opencode",
          ...props.paths,
        },
        capabilities: {
          mouse: true,
          copyOnSelect: true,
          terminalTitle: false,
          terminalSuspend: false,
          workspaces: false,
          showTimeToFirstDraw: false,
          ...props.capabilities,
        },
        terminal: {},
        editor: { zedTerminal: false, ...props.editor },
        skipInitialLoading: false,
      })}
    >
      {props.children}
    </TuiEnvironmentProvider>
  )
}
