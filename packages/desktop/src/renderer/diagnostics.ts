const resizeLoopWarning = "ResizeObserver loop completed with undelivered notifications."

if (import.meta.env.DEV) {
  installConsoleStacks()
  installResizeObserverStacks()
}

function installConsoleStacks() {
  console.warn = tracedConsole(console.warn.bind(console), "Console warning")
  console.error = tracedConsole(console.error.bind(console), "Console error")
}

function installResizeObserverStacks() {
  if (typeof ResizeObserver !== "function") return

  const NativeResizeObserver = ResizeObserver
  type ResizeTrace = {
    created: string
    last?: { at: number; targets: Element[] }
  }
  const observers = new Set<ResizeTrace>()

  class TracedResizeObserver extends NativeResizeObserver {
    private readonly trace: ResizeTrace

    constructor(callback: ResizeObserverCallback) {
      const trace: ResizeTrace = {
        created: diagnosticStack("ResizeObserver created"),
      }
      super((entries, observer) => {
        trace.last = { at: performance.now(), targets: entries.map((entry) => entry.target) }
        callback(entries, observer)
      })
      this.trace = trace
      observers.add(trace)
    }

    override disconnect() {
      observers.delete(this.trace)
      super.disconnect()
    }
  }

  globalThis.ResizeObserver = TracedResizeObserver
  window.addEventListener("error", (event) => {
    if (event.message !== resizeLoopWarning) return
    const now = performance.now()
    const active = [...observers]
      .flatMap((observer) => {
        if (!observer.last || now - observer.last.at >= 100) return []
        return [{ ...observer, last: observer.last }]
      })
      .sort((a, b) => b.last.at - a.last.at)
      .slice(0, 5)
    const detail = active.length
      ? active
          .map(
            (observer, index) =>
              `Recent ResizeObserver ${index + 1}; targets: ${observer.last.targets.map(describeElement).join(", ") || "none"}\n${observer.created}`,
          )
          .join("\n")
      : "No ResizeObserver callback was recorded in the previous 100 ms."
    console.warn(`[renderer diagnostics] ${resizeLoopWarning}\n${detail}`)
  })
}

function tracedConsole(write: (...args: unknown[]) => void, label: string) {
  const pending = new Map<string, { count: number }>()
  return (...args: unknown[]) => {
    const stack = diagnosticStack(label)
    const key = `${String(args[0])}\n${stack}`
    const current = pending.get(key)
    if (current) {
      current.count += 1
      return
    }

    const entry = { count: 0 }
    pending.set(key, entry)
    write(...args, stack)
    window.setTimeout(() => {
      pending.delete(key)
      if (entry.count) write(`${String(args[0])} (repeated ${entry.count} times)`)
    }, 1_000)
  }
}

function describeElement(element: Element) {
  const id = element.id ? `#${element.id}` : ""
  const classes = [...element.classList]
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join("")
  return `${element.tagName.toLowerCase()}${id}${classes}`
}

function diagnosticStack(label: string) {
  return new Error(label).stack ?? label
}
