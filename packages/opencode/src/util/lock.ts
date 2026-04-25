export const DEFAULT_TIMEOUT_MS = 30000

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Lock acquisition timeout after ${ms}ms`)), ms),
  )
}

const locks = new Map<
  string,
  {
    readers: number
    writer: boolean
    waitingReaders: (() => void)[]
    waitingWriters: (() => void)[]
  }
>()

function get(key: string) {
  if (!locks.has(key)) {
    locks.set(key, {
      readers: 0,
      writer: false,
      waitingReaders: [],
      waitingWriters: [],
    })
  }
  return locks.get(key)!
}

function process(key: string) {
  const lock = locks.get(key)
  if (!lock || lock.writer || lock.readers > 0) return

  if (lock.waitingWriters.length > 0) {
    const nextWriter = lock.waitingWriters.shift()!
    nextWriter()
    return
  }

  while (lock.waitingReaders.length > 0) {
    const nextReader = lock.waitingReaders.shift()!
    nextReader()
  }

  if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
    locks.delete(key)
  }
}

export async function read(key: string, timeoutMs?: number): Promise<Disposable> {
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const lock = get(key)

  const dispose = () => {
    lock.readers--
    process(key)
  }

  let tryAcquire: (() => void) | undefined

  const acquisition = new Promise<Disposable>((resolve) => {
    tryAcquire = () => {
      lock.readers++
      resolve({ [Symbol.dispose]: dispose })
    }

    if (!lock.writer && lock.waitingWriters.length === 0) {
      tryAcquire()
    } else {
      lock.waitingReaders.push(tryAcquire)
    }
  })

  try {
    return await Promise.race([acquisition, timeoutAfter(effectiveTimeout)])
  } catch (err) {
    if (tryAcquire) {
      const idx = lock.waitingReaders.indexOf(tryAcquire)
      if (idx !== -1) lock.waitingReaders.splice(idx, 1)
    }
    throw err
  }
}

export async function write(key: string, timeoutMs?: number): Promise<Disposable> {
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const lock = get(key)

  const dispose = () => {
    lock.writer = false
    process(key)
  }

  let tryAcquire: (() => void) | undefined

  const acquisition = new Promise<Disposable>((resolve) => {
    tryAcquire = () => {
      lock.writer = true
      resolve({ [Symbol.dispose]: dispose })
    }

    if (!lock.writer && lock.readers === 0) {
      tryAcquire()
    } else {
      lock.waitingWriters.push(tryAcquire)
    }
  })

  try {
    return await Promise.race([acquisition, timeoutAfter(effectiveTimeout)])
  } catch (err) {
    if (tryAcquire) {
      const idx = lock.waitingWriters.indexOf(tryAcquire)
      if (idx !== -1) lock.waitingWriters.splice(idx, 1)
    }
    throw err
  }
}
