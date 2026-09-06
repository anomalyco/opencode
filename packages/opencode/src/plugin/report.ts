import type { ConfigPlugin } from "@/config/plugin"

type MissingCandidate = {
  plan: { spec: string }
  origin: ConfigPlugin.Origin
}

// Skip reports must say WHERE the plugin was declared so users know which
// config to fix: a config-sourced and a local-file plugin fail for very
// different reasons despite identical specs.
export function missingMessage(candidate: MissingCandidate, message: string): string {
  return `Plugin ${candidate.plan.spec} (${candidate.origin.scope}: ${candidate.origin.source}) skipped: ${message}`
}
