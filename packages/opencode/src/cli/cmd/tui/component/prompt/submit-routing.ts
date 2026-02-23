export type SubmitIntent = "default" | "steer"

export type SubmitRoute = "prompt" | "steer" | "reject-steer-nontext"

export function routeSubmit(input: {
  busy: boolean
  intent: SubmitIntent
  hasNonText: boolean
}): SubmitRoute {
  if (!input.busy) return "prompt"
  if (input.intent === "default") return "prompt"
  if (input.hasNonText) return "reject-steer-nontext"
  return "steer"
}

export function isSteerKey(input: {
  busy: boolean
  mode: "normal" | "shell"
  matched: boolean
}) {
  return input.busy && input.mode === "normal" && input.matched
}

export function isSubmitRequestSuccess(result: unknown) {
  if (result === null || result === undefined) return false
  if (typeof result !== "object") return true

  const obj = result as Record<string, unknown>
  if ("error" in obj && obj.error !== undefined) return false

  if ("response" in obj) {
    const response = obj.response
    if (response && typeof response === "object") {
      const res = response as Record<string, unknown>
      if ("ok" in res) return !!res.ok
    }
  }

  return true
}
