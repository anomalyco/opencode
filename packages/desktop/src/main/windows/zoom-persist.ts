export type ZoomPersister = {
  push: (value: number) => void
  flush: () => void
}

const delay = 250

// Coalesces zoom changes before writing them. The first change is written immediately (keyboard and
// menu actions are one-shot), while a continuous pinch is collapsed into at most one trailing write
// per `delay`, so the settings file is not rewritten on every event.
export function createZoomPersister(write: (value: number) => void): ZoomPersister {
  let lastWritten: number | undefined
  let pending: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastAt = Number.NEGATIVE_INFINITY

  function emit(value: number) {
    if (value === lastWritten) return
    lastWritten = value
    write(value)
  }

  function flush() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }

    const value = pending
    pending = undefined

    if (value === undefined) return
    lastAt = Date.now()
    emit(value)
  }

  function push(value: number) {
    if (value === lastWritten && pending === undefined) return
    pending = value

    if (timer !== undefined) return

    const elapsed = Date.now() - lastAt

    if (elapsed >= delay) {
      lastAt = Date.now()
      pending = undefined
      emit(value)

      return
    }

    timer = setTimeout(flush, delay - elapsed)
  }

  return { push, flush }
}
