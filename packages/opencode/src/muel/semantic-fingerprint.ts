const STOPWORDS = new Set([
  "dan", "di", "ke", "dari", "yang", "ini", "itu", "dengan", "untuk", "pada",
  "adalah", "akan", "telah", "sudah", "tidak", "juga", "atau", "karena", "oleh",
  "sebagai", "dalam", "saat", "saya", "kami", "kita",
  "the", "a", "an", "is", "are",
])

export interface SemanticResult {
  collapse: boolean
  term?: string
  similarity?: number
}

export class SemanticFingerprintGuard {
  private fingerprints = new Map<string, Set<string>[]>()
  private sentenceBuffer = ""

  registerTerm(term: string): void {
    if (!this.fingerprints.has(term)) this.fingerprints.set(term, [])
  }

  feed(chunk: string): SemanticResult {
    this.sentenceBuffer += chunk
    const sentences = this.extractSentences()
    for (const sentence of sentences) {
      for (const [term, prints] of this.fingerprints) {
        const result = this.checkTerm(sentence, term, prints)
        if (result.collapse) return result
      }
    }
    return { collapse: false }
  }

  reset(): void {
    this.fingerprints.clear()
    this.sentenceBuffer = ""
  }

  listTerms(): string[] {
    return [...this.fingerprints.keys()]
  }

  private checkTerm(sentence: string, term: string, prints: Set<string>[]): SemanticResult {
    const lower = sentence.toLowerCase()
    const idx = lower.indexOf(term.toLowerCase())
    if (idx === -1) return { collapse: false }

    const ctx = this.extractContext(sentence, idx, idx + term.length)
    if (ctx.size === 0) return { collapse: false }

    if (prints.length === 0) {
      prints.push(ctx)
      return { collapse: false }
    }

    let bestSimilarity = 0
    for (const fp of prints) {
      const sim = this.jaccard(ctx, fp)
      if (sim > bestSimilarity) bestSimilarity = sim
    }

    if (bestSimilarity < 0.2) {
      prints.push(ctx)
      return { collapse: true, term, similarity: bestSimilarity }
    }

    return { collapse: false }
  }

  private extractContext(sentence: string, start: number, end: number): Set<string> {
    const before = sentence.substring(0, start).trim()
    const after = sentence.substring(end).trim()
    const beforeWords = before.length > 0 ? before.split(/\s+/) : []
    const afterWords = after.length > 0 ? after.split(/\s+/) : []
    const context = beforeWords.slice(-3).concat(afterWords.slice(0, 3))
    const filtered = context.filter(w => !STOPWORDS.has(w.toLowerCase())).map(w => w.toLowerCase())
    return new Set(filtered)
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    const union = new Set(a)
    for (const v of b) union.add(v)
    if (union.size === 0) return 1
    let intersection = 0
    for (const v of a) {
      if (b.has(v)) intersection++
    }
    return intersection / union.size
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
}
