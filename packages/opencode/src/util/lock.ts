type Release = () => void

const locks = new Map<string, Promise<void>>()

async function acquire(key: string): Promise<Disposable> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release: Release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(
    key,
    previous.then(() => current),
  )
  await previous

  return {
    [Symbol.dispose]() {
      release()
      if (locks.get(key) === current) locks.delete(key)
    },
  }
}

export const Lock = {
  read: acquire,
  write: acquire,
}
