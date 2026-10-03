const disposers = new Set<(directory: string) => Promise<void>>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

const DISPOSE_TIMEOUT_MS = 10_000

export async function disposeInstance(directory: string) {
  await Promise.allSettled(
    [...disposers].map((disposer) =>
      Promise.race([
        disposer(directory),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Disposer timed out after ${DISPOSE_TIMEOUT_MS}ms for ${directory}`)),
            DISPOSE_TIMEOUT_MS,
          ),
        ),
      ]),
    ),
  )
}
