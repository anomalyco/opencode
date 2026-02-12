import { type VirtualFileMetrics, Virtualizer } from "@pierre/diffs"

type Target = {
  key: Document | HTMLElement
  root: Document | HTMLElement
  content: HTMLElement | undefined
}

type Entry = {
  virtualizer: Virtualizer
  refs: number
}

const cache = new WeakMap<Document | HTMLElement, Entry>()

export const virtualMetrics: Partial<VirtualFileMetrics> = {
  lineHeight: 24,
  hunkSeparatorHeight: 24,
  fileGap: 0,
}

function target(container: HTMLElement): Target | undefined {
  if (typeof document === "undefined") return

  const root = container.closest("[data-component='session-review']")
  if (root instanceof HTMLElement) {
    const content = root.querySelector("[data-slot='session-review-container']")
    return {
      key: root,
      root,
      content: content instanceof HTMLElement ? content : undefined,
    }
  }

  return {
    key: document,
    root: document,
    content: undefined,
  }
}

export function acquireVirtualizer(container: HTMLElement) {
  const resolved = target(container)
  if (!resolved) return

  let entry = cache.get(resolved.key)
  if (!entry) {
    const virtualizer = new Virtualizer()
    virtualizer.setup(resolved.root, resolved.content)
    entry = {
      virtualizer,
      refs: 0,
    }
    cache.set(resolved.key, entry)
  }

  entry.refs += 1
  let done = false

  return {
    virtualizer: entry.virtualizer,
    release() {
      if (done) return
      done = true

      const current = cache.get(resolved.key)
      if (!current) return

      current.refs -= 1
      if (current.refs > 0) return

      current.virtualizer.cleanUp()
      cache.delete(resolved.key)
    },
  }
}
