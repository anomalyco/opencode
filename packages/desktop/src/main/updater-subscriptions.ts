export function createUpdaterSubscriptions() {
  const subscriptions = new Map<number, () => void>()

  const remove = (id: number) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  }

  return {
    set(id: number, unsubscribe: () => void) {
      remove(id)
      subscriptions.set(id, unsubscribe)
    },
    delete: remove,
    clear() {
      subscriptions.forEach((unsubscribe) => unsubscribe())
      subscriptions.clear()
    },
  }
}
