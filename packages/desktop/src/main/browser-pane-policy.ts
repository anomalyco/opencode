import { BrowserControl } from "@opencode-ai/core/browser-control"
import type { BrowserPaneBounds } from "../preload/types"

export const normalizeBrowserURL = BrowserControl.normalizeURL
export const allowedBrowserURL = BrowserControl.allowedURL
export const normalizeBrowserRef = BrowserControl.normalizeRef

export function invalidateBrowserRefs(state: { snapshot: number; refs: { clear(): void } }) {
  state.snapshot++
  state.refs.clear()
}

export function stopBrowserOperation(input: { active?: AbortController; stop(): void }) {
  input.active?.abort()
  input.stop()
}

export function boundedBrowserOperation<T>(
  run: () => PromiseLike<T>,
  input: {
    signal?: AbortSignal
    timeout: number
    aborted: () => Error
    timedOut: () => Error
  },
) {
  return new Promise<T>((resolve, reject) => {
    type OperationResult = { readonly run: false } | { readonly run: true; readonly value: T }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      input.signal?.removeEventListener("abort", onAbort)
    }
    const succeed = (value: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(input.aborted())

    if (input.signal?.aborted) {
      onAbort()
      return
    }
    input.signal?.addEventListener("abort", onAbort, { once: true })
    timer = setTimeout(() => fail(input.timedOut()), input.timeout)
    void Promise.resolve()
      .then<OperationResult>(() => {
        if (settled) return { run: false }
        return new Promise<OperationResult>((resolve, reject) => {
          run().then(
            (value) => resolve({ run: true, value }),
            (error) => reject(error),
          )
        })
      })
      .then((result) => {
        if (result.run) succeed(result.value)
      }, fail)
  })
}

export async function runBrowserInputPair(input: {
  assert: () => void
  press: () => Promise<void>
  release: () => Promise<void>
}) {
  input.assert()
  try {
    await input.press()
  } finally {
    await input.release()
  }
  input.assert()
}

export function normalizeBrowserBounds(
  input: BrowserPaneBounds,
  parent: BrowserPaneBounds,
): BrowserPaneBounds | undefined {
  if (![input.x, input.y, input.width, input.height].every(Number.isFinite)) return undefined
  const left = Math.max(0, Math.min(Math.round(input.x), parent.width))
  const top = Math.max(0, Math.min(Math.round(input.y), parent.height))
  const right = Math.max(left, Math.min(Math.round(input.x + input.width), parent.width))
  const bottom = Math.max(top, Math.min(Math.round(input.y + input.height), parent.height))
  if (right === left || bottom === top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Opaque corner masks cut only the bottom edge while the native view keeps square top corners. */
export function browserBottomMasks(bounds: BrowserPaneBounds) {
  if (bounds.width < 20 || bounds.height < 10) return []
  const segments = [
    { offset: 0, height: 2, width: 6 },
    { offset: 2, height: 2, width: 3 },
    { offset: 4, height: 2, width: 2 },
    { offset: 6, height: 4, width: 1 },
  ]
  return segments.flatMap((segment) => {
    const y = bounds.y + bounds.height - segment.offset - segment.height
    return [
      { x: bounds.x, y, width: segment.width, height: segment.height },
      { x: bounds.x + bounds.width - segment.width, y, width: segment.width, height: segment.height },
    ]
  })
}
