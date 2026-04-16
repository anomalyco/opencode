export type Hold = {
  width: number
  height: number
  until: number
}

export type Pipe<T> = {
  busy: boolean
  next?: T
}

export const pipe = <T>() =>
  ({
    busy: false,
    next: undefined as T | undefined,
  }) satisfies Pipe<T>

export const push = <T>(pipe: Pipe<T>, next: T) => {
  pipe.next = next
}

export const pull = <T>(pipe: Pipe<T>) => {
  if (pipe.busy || !pipe.next) return
  pipe.busy = true
  const next = pipe.next
  pipe.next = undefined
  return next
}

export const done = <T>(pipe: Pipe<T>) => {
  pipe.busy = false
  return pull(pipe)
}

export const fit = (hold: Hold | undefined, width?: number, height?: number, now = Date.now(), clear = true) => {
  if (!hold) return { hold, ok: true }
  if (now >= hold.until) return { hold: undefined, ok: true }
  if (!width || !height) return { hold, ok: false }
  if (Math.abs(width - hold.width) > 3 || Math.abs(height - hold.height) > 3) {
    return { hold, ok: false }
  }
  if (!clear) return { hold, ok: true }
  return { hold: undefined, ok: true }
}
