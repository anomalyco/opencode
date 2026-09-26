export type Visibility = "show" | "hide"

export type VisibilityEntry = {
  providerID: string
  modelID: string
  visibility: Visibility
}

function keyOf(model: { providerID: string; modelID: string }) {
  return `${model.providerID}:${model.modelID}`
}

type Row<T> = Omit<T, "visibility"> & { visibility: Visibility }

/**
 * Preference list after showing or hiding every model of one provider.
 * Returns the same array when every targeted model is already in that state.
 */
export function applyProviderVisibility<T extends VisibilityEntry>(
  user: readonly T[],
  models: readonly { providerID: string; modelID: string }[],
  visibility: Visibility,
): Row<T>[] {
  const index = new Map<string, number>()
  for (let i = 0; i < user.length; i++) {
    const key = keyOf(user[i])
    if (!index.has(key)) index.set(key, i)
  }

  let next: Row<T>[] | undefined
  const ensure = () => (next ??= user.slice() as Row<T>[])

  for (const model of models) {
    const key = keyOf(model)
    const currentIndex = index.get(key)
    if (currentIndex === undefined) {
      const list = ensure()
      index.set(key, list.length)
      list.push({ providerID: model.providerID, modelID: model.modelID, visibility } as Row<T>)
      continue
    }
    const current = (next ?? user)[currentIndex]
    if (current.visibility === visibility) continue
    const list = ensure()
    list[currentIndex] = { ...current, visibility }
  }

  return next ?? (user as unknown as Row<T>[])
}
