import type { PermissionMode } from "./context/permission"

export type ModeCycleState = {
  agent: string
  permission: PermissionMode
}

export function cycleMode(input: {
  direction: 1 | -1
  current: ModeCycleState
  available: string[]
  autoApprove?: boolean
}): ModeCycleState {
  if (input.current.permission === "auto") {
    const current = input.available.indexOf(input.current.agent)
    if (current === -1)
      return {
        agent: input.available.at(input.direction === 1 ? 0 : -1) ?? input.current.agent,
        permission: "auto",
      }
    const next = (current + input.direction + input.available.length) % input.available.length
    return { agent: input.available[next], permission: "auto" }
  }

  const build = input.available.includes("build")
  const ring: ModeCycleState[] = [
    ...(build ? [{ agent: "build", permission: "normal" as const }] : []),
    ...(input.available.includes("plan") ? [{ agent: "plan", permission: "normal" as const }] : []),
    ...(build && input.autoApprove ? [{ agent: "build", permission: "review" as const }] : []),
    ...input.available
      .filter((agent) => agent !== "build" && agent !== "plan")
      .map((agent) => ({ agent, permission: "normal" as const })),
  ]
  if (ring.length === 0) return { agent: input.current.agent, permission: "normal" }
  const current = ring.findIndex(
    (state) => state.agent === input.current.agent && state.permission === input.current.permission,
  )
  if (current === -1) return ring.at(input.direction === 1 ? 0 : -1) ?? ring[0]
  return ring[(current + input.direction + ring.length) % ring.length]
}

export function modeLabel(state: ModeCycleState) {
  if (state.permission === "review" && state.agent === "build") return "Auto-approve"
  if (state.agent === "build") return "Build"
  if (state.agent === "plan") return "Plan"
  return state.agent
}
