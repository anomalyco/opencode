import { createMemo, Show, type ParentProps } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { DEFAULT_THEMES, resolveTheme } from "../theme"
import { TUI_STARTUP_STAGES, type TuiStartupStage } from "../context/runtime"

const labels: Record<TuiStartupStage, string> = {
  terminal: "Initializing terminal...",
  settings: "Loading local settings...",
  workspace: "Loading workspace and providers...",
  theme: "Applying theme...",
  plugins: "Loading plugins...",
  ready: "Ready",
}

export function StartupLoading(
  props: ParentProps<{
    stage: () => TuiStartupStage
    mode: () => "dark" | "light" | undefined
    hidden: boolean
  }>,
) {
  const dimensions = useTerminalDimensions()
  // This renders before KV and Theme providers exist, so use the built-in palette directly.
  const theme = createMemo(() => resolveTheme(DEFAULT_THEMES.opencode!, props.mode() ?? "dark"))
  const progress = createMemo(() => startupProgress(props.stage(), Math.max(4, Math.min(24, dimensions().width - 8))))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme().background}
    >
      {props.children}
      <Show when={!props.hidden && props.stage() !== "ready"}>
        <box
          position="absolute"
          zIndex={5000}
          top={0}
          bottom={0}
          left={0}
          right={0}
          justifyContent="center"
          alignItems="center"
          backgroundColor={theme().background}
        >
          <box flexDirection="column" alignItems="center" gap={1}>
            <text fg={theme().primary}>{progress().bar}</text>
            <text fg={theme().textMuted}>
              {progress().completed}/{progress().total} {progress().label}
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}

export function startupProgress(stage: TuiStartupStage, width: number) {
  const completed = TUI_STARTUP_STAGES.indexOf(stage)
  const total = TUI_STARTUP_STAGES.length - 1
  const filled = Math.round((completed / total) * width)
  return {
    bar: `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`,
    completed,
    total,
    label: labels[stage],
  }
}
