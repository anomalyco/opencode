export interface TermSize {
  width: number
  height: number
}

export function getTermSize(): TermSize {
  if (process.stdout.isTTY) {
    return {
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24,
    }
  }
  return { width: 80, height: 24 }
}

export function listenResize(callback: (size: TermSize) => void): () => void {
  if (process.platform !== "win32") {
    const handler = () => callback(getTermSize())
    process.on("SIGWINCH", handler)
    return () => process.off("SIGWINCH", handler)
  }

  let last = getTermSize()
  const timer = setInterval(() => {
    const current = getTermSize()
    if (current.width !== last.width || current.height !== last.height) {
      last = current
      callback(current)
    }
  }, 100)

  return () => clearInterval(timer)
}
