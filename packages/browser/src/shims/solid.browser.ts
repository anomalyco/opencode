// Minimal solid-js stubs for browser (TUI components reference these)
export function createSignal<T>(value: T): [() => T, (v: T) => void] {
  let current = value
  return [() => current, (v: T) => { current = v }]
}

export function createEffect(fn: () => void): void {
  // No-op in browser - TUI effects not needed
}

export function createMemo<T>(fn: () => T): () => T {
  return fn
}

export function onMount(fn: () => void): void {}
export function onCleanup(fn: () => void): void {}
export function createResource(): any { return [() => undefined, { refetch: () => {} }] }
export function batch(fn: () => void): void { fn() }
export function untrack<T>(fn: () => T): T { return fn() }

export default {
  createSignal, createEffect, createMemo, onMount, onCleanup,
  createResource, batch, untrack,
}
