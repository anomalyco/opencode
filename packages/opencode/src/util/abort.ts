/**
 * Creates an AbortController that automatically aborts after a timeout.
 *
 * Uses bind() instead of arrow functions to avoid capturing the surrounding
 * scope in closures. Arrow functions like `() => controller.abort()` capture
 * request bodies and other large objects, preventing GC for the timer lifetime.
 *
 * @param ms Timeout in milliseconds
 * @returns Object with controller, signal, and clearTimeout function
 */
export function abortAfter(ms: number) {
  const controller = new AbortController()
  const id = setTimeout(controller.abort.bind(controller), ms)
  return {
    controller,
    signal: controller.signal,
    clearTimeout: () => globalThis.clearTimeout(id),
  }
}

export function abortAfterAny(ms: number, ...signals: AbortSignal[]) {
  const timeout = abortAfter(ms)
  const signal = AbortSignal.any([timeout.signal, ...signals])
  return {
    signal,
    clearTimeout: timeout.clearTimeout,
  }
}

function propagate(this: WeakRef<AbortController>, ref: WeakRef<AbortController>) {
  const child = ref.deref()
  const parent = this.deref()
  if (child && !child.signal.aborted) child.abort(parent?.signal.reason)
}

function detach(this: WeakRef<AbortController>, ref: WeakRef<(...args: any[]) => void>) {
  const parent = this.deref()
  const handler = ref.deref()
  if (parent && handler) parent.signal.removeEventListener("abort", handler)
}

// Creates a child AbortController linked to a parent via WeakRef.
// The parent does not retain the child — abandoned children are GC'd.
// When the child aborts, it auto-removes its listener from the parent.
export function childAbort(parent: AbortController) {
  const child = new AbortController()
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return child
  }
  const weak = new WeakRef(child)
  const weakParent = new WeakRef(parent)
  const handler = propagate.bind(weakParent, weak)
  parent.signal.addEventListener("abort", handler, { once: true })
  child.signal.addEventListener("abort", detach.bind(weakParent, new WeakRef(handler)), { once: true })
  return child
}
