export type PowerSaveBlockerLike = {
  start(type: "prevent-display-sleep"): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export type KeepAwakeStorage = {
  get(): boolean
  set(value: boolean): void
}

export function createKeepAwakeController(blocker: PowerSaveBlockerLike, storage: KeepAwakeStorage) {
  let blockerId: number | undefined

  const apply = (enabled: boolean) => {
    if (enabled) {
      if (blockerId !== undefined && blocker.isStarted(blockerId)) return
      blockerId = blocker.start("prevent-display-sleep")
      return
    }

    if (blockerId === undefined) return
    if (blocker.isStarted(blockerId)) blocker.stop(blockerId)
    blockerId = undefined
  }

  return {
    initialize() {
      apply(storage.get())
    },
    getEnabled() {
      return storage.get()
    },
    setEnabled(enabled: boolean) {
      storage.set(enabled)
      apply(enabled)
    },
    stop() {
      if (blockerId === undefined) return
      if (blocker.isStarted(blockerId)) blocker.stop(blockerId)
      blockerId = undefined
    },
  }
}
