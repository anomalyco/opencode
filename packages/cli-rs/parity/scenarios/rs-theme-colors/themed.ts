// Reruns another step's scenario in a pinned theme, so P-APP compares the colors of every surface it shows in
// themes other than the default. `deviation` replaces the deviations of every checkpoint.
import type { AppScenario } from "../../lib/app"

export function themed(base: AppScenario, name: string, mode: "dark" | "light", deviation?: string[]) {
  return {
    ...base,
    config: { ...base.config, theme: { name, mode } },
    steps: deviation ? base.steps.map((step) => ("checkpoint" in step ? { ...step, deviation } : step)) : base.steps,
  }
}
