export type ModelKey = { providerID: string; modelID: string; variant?: string }

export type ModelSelectionState = {
  agent?: string
  model?: ModelKey
  variant?: string | null
}

const WORKSPACE_KEY = "__workspace__"

export function migrateModelSelection(value: unknown) {
  if (!value || typeof value !== "object") return { session: {} }

  const item = value as {
    session?: Record<string, ModelSelectionState | undefined>
    pick?: Record<string, ModelSelectionState | undefined>
  }
  const sessions = item.session && typeof item.session === "object" ? item.session : item.pick
  if (!sessions || typeof sessions !== "object") return { session: {} }

  return {
    session: Object.fromEntries(
      Object.entries(sessions)
        .filter(([key]) => key !== WORKSPACE_KEY)
        .map(([key, state]) => [key, state?.variant === "default" ? { ...state, variant: null } : state]),
    ),
  }
}
