export class ContextAnchor {
  private definitions = new Map<string, string>()
  private chunkCounter = 0
  private readonly REINJECT_INTERVAL = 5

  define(term: string, definition: string): void {
    this.definitions.set(term.toLowerCase(), definition)
  }

  checkChunk(): string | null {
    this.chunkCounter++
    if (this.definitions.size === 0) return null
    if (this.chunkCounter % this.REINJECT_INTERVAL === 0) {
      return this.formatDefinitions()
    }
    return null
  }

  private formatDefinitions(): string {
    const lines: string[] = ["[ANCHOR] Definisi tetap yang wajib dipertahankan:"]
    let idx = 1
    for (const [term, def] of this.definitions) {
      lines.push(`${idx}. "${term}" = "${def}"`)
      idx++
    }
    return lines.join("\n")
  }

  defineBatch(pairs: [string, string][]): void {
    for (const [term, def] of pairs) {
      this.define(term, def)
    }
  }

  getDefinition(term: string): string | undefined {
    return this.definitions.get(term.toLowerCase())
  }

  reset(): void {
    this.definitions.clear()
    this.chunkCounter = 0
  }
}
