// Simplified ignore shim for browser
function ignore() {
  const patterns: string[] = []

  const instance = {
    add(pattern: string | string[]) {
      if (Array.isArray(pattern)) {
        patterns.push(...pattern)
      } else {
        patterns.push(pattern)
      }
      return instance
    },
    ignores(filepath: string): boolean {
      for (const pattern of patterns) {
        if (pattern.startsWith("!")) continue
        if (filepath.includes(pattern.replace(/\*/g, ""))) return true
      }
      return false
    },
    filter(paths: string[]): string[] {
      return paths.filter(p => !instance.ignores(p))
    },
    createFilter() {
      return (p: string) => !instance.ignores(p)
    },
  }

  return instance
}

export default ignore
