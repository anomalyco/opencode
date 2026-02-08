/**
 * Retry utility for operations that may need multiple attempts.
 *
 * @param fn - Function to retry. Return `true` to stop, `false` to continue retrying.
 * @param options - Configuration options
 * @returns A stop function to cancel retries
 */
export function retry(
  fn: () => boolean,
  options: {
    delay?: number
    max?: number
    onDone?: (success: boolean) => void
  } = {},
): () => void {
  const { delay = 50, max = 8, onDone } = options
  let attempts = 0
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = () => {
    if (stopped) return

    attempts++
    const result = fn()

    if (result) {
      onDone?.(true)
      return
    }

    if (attempts >= max) {
      onDone?.(false)
      return
    }

    timer = setTimeout(tick, delay)
  }

  tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
