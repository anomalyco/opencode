export { ACTIVE_WSL_MOCK_SCENARIO, createWslMockState, wslMockScenarios, type WslMockScenario } from "./scenarios"
export { createWslMockPlatform } from "./platform"

/** Desktop dev on macOS/Linux uses mock WSL data unless VITE_WSL_MOCK=0. */
export function wslMockEnabled() {
  if (import.meta.env.VITE_WSL_MOCK === "0") return false
  if (import.meta.env.VITE_WSL_MOCK === "1") return true
  return import.meta.env.DEV
}
