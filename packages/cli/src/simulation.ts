declare const OPENCODE_SIMULATION: boolean

export const SimulationBuild = {
  enabled: typeof OPENCODE_SIMULATION === "boolean" ? OPENCODE_SIMULATION : true,
  unavailable: "Simulation is not included in production OpenCode builds. Use opencode-drive start --dev <checkout>.",
}
