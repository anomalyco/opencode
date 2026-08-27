const resizeLoopWarning = "ResizeObserver loop completed with undelivered notifications."

if (import.meta.env.DEV) {
  installConsoleStacks()
  window.addEventListener("error", (event) => {
    if (event.message === resizeLoopWarning) event.preventDefault()
  })
}

function installConsoleStacks() {
  console.warn = tracedConsole(console.warn.bind(console), "Console warning")
  console.error = tracedConsole(console.error.bind(console), "Console error")
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

function diagnosticStack(label: string) {
  return new Error(label).stack ?? label
}
