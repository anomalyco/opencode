type ModelSelection<P extends string, M extends string, V extends string> = {
  model: {
    current(): { id: M; provider: { id: P } } | undefined
    variant: {
      current(): V | undefined
    }
  }
}

type PromptState<P extends string, M extends string, V extends string> = {
  model: {
    current(): { providerID: P; modelID: M; variant?: V | null } | undefined
    set(model: { providerID: P; modelID: M; variant?: V | null }): void
  }
}

export const syncPromptModel = <P extends string, M extends string, V extends string>(
  local: ModelSelection<P, M, V>,
  prompt: PromptState<P, M, V>,
) => {
  const model = local.model.current()
  if (!model) return
  const next = {
    providerID: model.provider.id,
    modelID: model.id,
    variant: local.model.variant.current(),
  }
  const current = prompt.model.current()
  if (current?.providerID === next.providerID && current.modelID === next.modelID && current.variant === next.variant)
    return
  prompt.model.set(next)
}
