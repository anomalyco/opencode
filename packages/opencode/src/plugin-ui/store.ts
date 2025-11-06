/**
 * Global State Management for Plugin UIs
 * 
 * Provides a simple store pattern for sharing state across multiple
 * plugin components (widgets, panels, status items).
 * 
 * Usage:
 * ```tsx
 * import { createStore } from "@opencode/plugin-ui/store"
 * 
 * const store = createStore({
 *   counter: 0,
 *   todos: []
 * })
 * 
 * // In widget A
 * <button onClick={() => store.set.counter(c => c + 1)}>+</button>
 * 
 * // In widget B
 * <text>Count: {store.counter()}</text>
 * ```
 */

import { createSignal, Accessor, Setter } from "solid-js"

export type Store<T extends Record<string, any>> = {
  [K in keyof T]: Accessor<T[K]>
} & {
  set: {
    [K in keyof T]: Setter<T[K]>
  }
  reset: () => void
  update: (updater: (state: T) => Partial<T>) => void
  subscribe: (listener: (state: T) => void) => () => void
}

export function createStore<T extends Record<string, any>>(initial: T): Store<T> {
  const signals: Record<string, [Accessor<any>, Setter<any>]> = {}
  const listeners: Set<(state: T) => void> = new Set()
  
  // Create signals for each key
  for (const key in initial) {
    signals[key] = createSignal(initial[key])
  }
  
  // Build getters
  const getters = {} as { [K in keyof T]: Accessor<T[K]> }
  for (const key in initial) {
    getters[key as keyof T] = signals[key][0]
  }
  
  // Build setters
  const setters = {} as { [K in keyof T]: Setter<T[K]> }
  for (const key in initial) {
    const setter = signals[key][1]
    setters[key as keyof T] = ((value: any) => {
      setter(value)
      notifyListeners()
    }) as Setter<T[keyof T]>
  }
  
  // Get current state snapshot
  const getState = (): T => {
    const state = {} as T
    for (const key in initial) {
      state[key as keyof T] = signals[key][0]()
    }
    return state
  }
  
  // Notify all listeners
  const notifyListeners = () => {
    const state = getState()
    for (const listener of listeners) {
      listener(state)
    }
  }
  
  // Reset to initial values
  const reset = () => {
    for (const key in initial) {
      signals[key][1](initial[key])
    }
    notifyListeners()
  }
  
  // Update multiple values at once
  const update = (updater: (state: T) => Partial<T>) => {
    const currentState = getState()
    const updates = updater(currentState)
    
    for (const key in updates) {
      if (key in signals) {
        signals[key][1](updates[key])
      }
    }
    notifyListeners()
  }
  
  // Subscribe to state changes
  const subscribe = (listener: (state: T) => void): (() => void) => {
    listeners.add(listener)
    // Call immediately with current state
    listener(getState())
    
    // Return unsubscribe function
    return () => {
      listeners.delete(listener)
    }
  }
  
  return {
    ...getters,
    set: setters,
    reset,
    update,
    subscribe,
  }
}

/**
 * Create a persisted store that saves to localStorage
 */
export function createPersistedStore<T extends Record<string, any>>(
  key: string,
  initial: T,
): Store<T> {
  // Try to load from storage
  let savedState = initial
  try {
    const saved = localStorage?.getItem(key)
    if (saved) {
      savedState = { ...initial, ...JSON.parse(saved) }
    }
  } catch (e) {
    // localStorage not available or parse error
  }
  
  const store = createStore(savedState)
  
  // Subscribe to changes and persist
  store.subscribe((state) => {
    try {
      localStorage?.setItem(key, JSON.stringify(state))
    } catch (e) {
      // localStorage not available
    }
  })
  
  return store
}
