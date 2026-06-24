const CAUSAL_CONNECTORS = new Set([
  "karena", "sehingga", "oleh karena itu", "maka",
  "dengan demikian", "akibatnya", "disebabkan", "mengakibatkan",
  "karena itu", "hal ini", "berdasarkan",
])

export class LogicalCycleDetector {
  private claimGraph = new Map<string, Set<string>>()
  private sentenceBuffer = ""

  feed(chunk: string): { cycle: boolean; path: string[] } {
    this.sentenceBuffer += chunk
    const sentences = this.extractSentences()
    for (const sentence of sentences) {
      const edge = this.parseCausalEdge(sentence)
      if (edge) {
        this.addEdge(edge.cause, edge.effect)
        const cycle = this.detectCycle()
        if (cycle.cycle) return cycle
      }
    }
    const edge = this.parseCausalEdge(this.sentenceBuffer)
    if (edge) {
      this.addEdge(edge.cause, edge.effect)
      this.sentenceBuffer = ""
      const cycle = this.detectCycle()
      if (cycle.cycle) return cycle
    }
    return { cycle: false, path: [] }
  }

  private parseCausalEdge(sentence: string): { cause: string; effect: string } | null {
    const lower = sentence.toLowerCase()
    for (const connector of CAUSAL_CONNECTORS) {
      const idx = lower.indexOf(connector)
      if (idx === -1) continue
      const effect = sentence.substring(0, idx).trim()
      const cause = sentence.substring(idx + connector.length).trim()
      const effectClean = effect.replace(/[^a-zA-Z0-9\s]/g, "")
      const causeClean = cause.replace(/[^a-zA-Z0-9\s]/g, "")
      if (effectClean.split(/\s+/).length >= 3 && causeClean.split(/\s+/).length >= 3) {
        const effectKey = effectClean.split(/\s+/).slice(0, 3).join(" ").toLowerCase()
        const causeKey = causeClean.split(/\s+/).slice(0, 3).join(" ").toLowerCase()
        return { cause: causeKey, effect: effectKey }
      }
    }
    return null
  }

  private addEdge(cause: string, effect: string): void {
    if (!this.claimGraph.has(cause)) this.claimGraph.set(cause, new Set())
    this.claimGraph.get(cause)!.add(effect)
  }

  private detectCycle(): { cycle: boolean; path: string[] } {
    const WHITE = 0, GRAY = 1, BLACK = 2
    const color = new Map<string, number>()
    const parent = new Map<string, string | null>()

    const dfs = (node: string): string[] | null => {
      color.set(node, GRAY)
      for (const neighbor of (this.claimGraph.get(node) ?? new Set())) {
        if (!color.has(neighbor) || color.get(neighbor) === WHITE) {
          parent.set(neighbor, node)
          const cycle = dfs(neighbor)
          if (cycle) return cycle
        } else if (color.get(neighbor) === GRAY) {
          const path: string[] = [neighbor]
          let cur: string | null | undefined = node
          while (cur !== undefined && cur !== null && cur !== neighbor) {
            path.unshift(cur)
            cur = parent.get(cur)
          }
          path.unshift(neighbor)
          return path
        }
      }
      color.set(node, BLACK)
      return null
    }

    for (const node of this.claimGraph.keys()) {
      if (!color.has(node) || color.get(node) === WHITE) {
        parent.set(node, null)
        const cycle = dfs(node)
        if (cycle) return { cycle: true, path: cycle }
      }
    }
    return { cycle: false, path: [] }
  }

  private extractSentences(): string[] {
    const re = /(?<=[.!?\n])\s+/
    const parts = this.sentenceBuffer.split(re)
    if (parts.length > 1) {
      const complete = parts.slice(0, -1).filter(s => s.trim().length > 0)
      this.sentenceBuffer = parts.at(-1) ?? ""
      return complete
    }
    return []
  }

  reset(): void {
    this.claimGraph.clear()
    this.sentenceBuffer = ""
  }
}
