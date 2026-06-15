import type { LoopMetrics } from "./loop-orchestrator"

let currentMetrics: LoopMetrics | null = null
let currentPhaseName = ""
let currentPhaseStatus: "pending" | "in_progress" | "completed" | "failed" = "pending"

export function setLoopMetrics(metrics: LoopMetrics, phaseName?: string, phaseStatus?: "pending" | "in_progress" | "completed" | "failed") {
  currentMetrics = metrics
  if (phaseName !== undefined) currentPhaseName = phaseName
  if (phaseStatus !== undefined) currentPhaseStatus = phaseStatus
}

export function getLoopMetrics() {
  return {
    metrics: currentMetrics,
    phaseName: currentPhaseName,
    phaseStatus: currentPhaseStatus,
  }
}

export function resetLoopMetrics() {
  currentMetrics = null
  currentPhaseName = ""
  currentPhaseStatus = "pending"
}
