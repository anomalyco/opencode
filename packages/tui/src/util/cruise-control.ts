export function cruiseControlConclusion(metadata: Record<string, unknown> | undefined): string | undefined {
  const review = metadata?.cruise_control_review
  if (typeof review === "object" && review !== null && !Array.isArray(review)) {
    const risk = "risk" in review ? review.risk : undefined
    const intent = "intent" in review ? review.intent : undefined
    const reason = "reason" in review ? review.reason : undefined
    const level = (value: unknown) => value === "high" || value === "medium" || value === "low"
    if (level(risk) && level(intent) && typeof reason === "string" && reason.trim()) {
      return `Risk: ${risk} · Intent: ${intent} — ${reason.trim()}`
    }
  }
  const value = metadata?.cruise_control
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
