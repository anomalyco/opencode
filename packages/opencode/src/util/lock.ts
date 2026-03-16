/**
 * Provides read-write lock synchronization for async operations.
 *
 * This namespace implements a multiple-reader/single-writer lock pattern
 * that allows concurrent read access while ensuring exclusive write access.
 * Uses a priority system that favors writers to prevent writer starvation.
 * Locks are automatically released using the Disposable pattern.
 *
 * @example
 * ```typescript
 * // Acquire a read lock
 * using readLock = await Lock.read("resource-key")
 * // Read operations here
 *
 * // Acquire a write lock
 * using writeLock = await Lock.write("resource-key")
 * // Write operations here
 * ```
 */
export namespace Lock {
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

    // Prioritize writers to prevent starvation
    if (lock.waitingWriters.length > 0) {
      const nextWriter = lock.waitingWriters.shift()!
      nextWriter()
      return
    }

    // Wake up all waiting readers
    while (lock.waitingReaders.length > 0) {
      const nextReader = lock.waitingReaders.shift()!
      nextReader()
    }

    // Clean up empty locks
    if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
      locks.delete(key)
    }
  }

  /**
   * Acquires a read lock for the specified key.
   *
   * Multiple concurrent readers are allowed when no writer holds the lock.
 * Readers are blocked if a writer is active or waiting (writer priority).
   * Returns a Disposable that automatically releases the lock.
   *
   * @param key - The resource key to lock
   * @returns A promise resolving to a Disposable lock handle
   * @example
   * ```typescript
   * using lock = await Lock.read("data.json")
   * const content = await readFile("data.json")
   * // Lock automatically released when 'lock' goes out of scope
   * ```
   */
  export async function read(key: string): Promise<Disposable> {
    const lock = get(key)

    return new Promise((resolve) => {
      if (!lock.writer && lock.waitingWriters.length === 0) {
        lock.readers++
        resolve({
          [Symbol.dispose]: () => {
            lock.readers--
            process(key)
          },
        })
      } else {
        lock.waitingReaders.push(() => {
          lock.readers++
          resolve({
            [Symbol.dispose]: () => {
              lock.readers--
              process(key)
            },
          })
        })
      }
    })
  }

  /**
   * Acquires a write lock for the specified key.
   *
   * Only one writer is allowed at a time. Writers have priority over new
   * readers to prevent starvation. Returns a Disposable that automatically
   * releases the lock.
   *
   * @param key - The resource key to lock
   * @returns A promise resolving to a Disposable lock handle
   * @example
   * ```typescript
   * using lock = await Lock.write("data.json")
   * await writeFile("data.json", newData)
   * // Lock automatically released when 'lock' goes out of scope
   * ```
   */
  export async function write(key: string): Promise<Disposable> {
    const lock = get(key)

    return new Promise((resolve) => {
      if (!lock.writer && lock.readers === 0) {
        lock.writer = true
        resolve({
          [Symbol.dispose]: () => {
            lock.writer = false
            process(key)
          },
        })
      } else {
        lock.waitingWriters.push(() => {
          lock.writer = true
          resolve({
            [Symbol.dispose]: () => {
              lock.writer = false
              process(key)
            },
          })
        })
      }
    })
  }
}
