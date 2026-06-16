import type { CliRenderer } from "@opentui/core"

type ThemeModeProbeEnvironment = Readonly<{
  STY?: string
  TERM?: string
  TMUX?: string
}>

type ThemeModeRenderer = Pick<CliRenderer, "waitForThemeMode">

function currentThemeModeProbeEnvironment(): ThemeModeProbeEnvironment {
  return {
    STY: process.env.STY,
    TERM: process.env.TERM,
    TMUX: process.env.TMUX,
  }
}

export function shouldSkipInitialThemeModeProbe(env: ThemeModeProbeEnvironment = currentThemeModeProbeEnvironment()) {
  const term = env.TERM ?? ""
  return Boolean(env.TMUX || env.STY || term.startsWith("tmux") || term.startsWith("screen"))
}

export async function resolveInitialThemeMode(renderer: ThemeModeRenderer, env?: ThemeModeProbeEnvironment) {
  if (shouldSkipInitialThemeModeProbe(env)) return "dark"
  return (await renderer.waitForThemeMode(1000)) ?? "dark"
}
