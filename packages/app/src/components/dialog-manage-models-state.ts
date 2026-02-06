type Item = {
  id: string
  provider: {
    id: string
  }
}

type Key = {
  modelID: string
  providerID: string
}

function modelKey(item: Item): Key {
  return {
    modelID: item.id,
    providerID: item.provider.id,
  }
}

export function allModelsVisible(list: Item[], visible: (model: Key) => boolean) {
  if (list.length === 0) return false
  return list.every((item) => visible(modelKey(item)))
}
