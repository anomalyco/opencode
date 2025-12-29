// packages/opencode/src/cli/cmd/tui/view/registry.ts
import { View } from "./types"

type ViewChangeCallback = (view: View.Info) => void

const views = new Map<string, View.Info>()
const subscribers = new Map<string, Set<ViewChangeCallback>>()

export namespace ViewRegistry {
  export function register(id: string, view: View.Info): void {
    views.set(id, view)
    notifySubscribers(id, view)
  }

  export function get(id: string): View.Info | undefined {
    return views.get(id)
  }

  export function unregister(id: string): void {
    views.delete(id)
  }

  export function list(): View.Info[] {
    return Array.from(views.values())
  }

  export function clear(): void {
    views.clear()
    subscribers.clear()
  }

  export function subscribe(id: string, callback: ViewChangeCallback): () => void {
    if (!subscribers.has(id)) {
      subscribers.set(id, new Set())
    }
    subscribers.get(id)!.add(callback)

    return () => {
      subscribers.get(id)?.delete(callback)
    }
  }

  function notifySubscribers(id: string, view: View.Info): void {
    const subs = subscribers.get(id)
    if (subs) {
      subs.forEach((callback) => callback(view))
    }
  }
}
