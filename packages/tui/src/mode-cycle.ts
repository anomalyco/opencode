import type { PermissionMode } from "./context/permission"

export type ModeCycleState = {
  agent: string
  permission: PermissionMode
}

export function startupPermissionMode(input: { auto?: boolean; agent?: string }): PermissionMode {
  return input.auto && (!input.agent || input.agent === "build") ? "auto" : "normal"
}

export function startupMode(input: {
  auto?: boolean
  agent?: string
  current: string
  available: string[]
}): ModeCycleState {
  if (input.agent && !input.available.includes(input.agent)) return realAgentMode(input.current)
  const selected = input.agent ?? input.current
  if (startupPermissionMode(input) === "auto") return enableAutoMode(selected, input.available)
  return realAgentMode(selected)
}

export function realAgentMode(agent: string): ModeCycleState {
  return { agent, permission: "normal" }
}

export function enableAutoMode(current: string, available: string[]): ModeCycleState {
  return available.includes("build") ? { agent: "build", permission: "auto" } : realAgentMode(current)
}

export function disableAutoMode(current: string, available: string[]): ModeCycleState {
  return realAgentMode(available.includes("build") ? "build" : current)
}

export function modeLabel(state: ModeCycleState) {
  if (state.permission === "auto" && state.agent === "build") return "Auto-approve"
  if (state.agent === "build") return "Build"
  if (state.agent === "plan") return "Plan"
  return state.agent
}

export function cycleMode(input: { direction: 1 | -1; current: ModeCycleState; available: string[] }): ModeCycleState {
  const build = input.available.includes("build")
  const plan = input.available.includes("plan")
  const ring = [
    ...(build ? ([{ agent: "build", permission: "normal" }] as const) : []),
    ...(plan ? ([{ agent: "plan", permission: "normal" }] as const) : []),
    ...(build ? ([{ agent: "build", permission: "auto" }] as const) : []),
  ]
  if (ring.length === 0) return { agent: input.current.agent, permission: "normal" }

  const current = ring.findIndex(
    (state) => state.agent === input.current.agent && state.permission === input.current.permission,
  )
  if (current === -1) return input.direction === 1 ? ring[0] : ring[ring.length - 1]
  const next = (current + input.direction + ring.length) % ring.length
  return ring[next]
}

export function paletteModeTitle(mode: PermissionMode) {
  return mode === "auto" ? "Disable auto-approve mode" : "Enable auto-approve mode"
}
