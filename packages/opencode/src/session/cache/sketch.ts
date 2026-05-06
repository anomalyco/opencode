export interface SketchConfig {
  dims: number
  minSimilarity: number
}

export const DEFAULTS: SketchConfig = { dims: 128, minSimilarity: 0.2 }

class TokenSketcher {
  readonly dims: number

  constructor(dims: number = DEFAULTS.dims) {
    this.dims = dims
  }

  *hashes(text: string, n: number, dims: number): Generator<number> {
    for (let i = 0; i < text.length - n + 1; i++) {
      const gram = text.slice(i, i + n)
      let hash = 0
      for (let j = 0; j < gram.length; j++) {
        hash = ((hash << 5) - hash + gram.charCodeAt(j)) | 0
      }
      yield Math.abs(hash) % dims
    }
  }

  toSketch(text: string): Float64Array {
    const sketch = new Float64Array(this.dims)
    for (const h of this.hashes(text, 1, this.dims)) sketch[h] += 1
    for (const h of this.hashes(text, 2, this.dims)) sketch[h] += 0.5
    const norm = Math.sqrt(sketch.reduce((s, v) => s + v * v, 0))
    if (norm > 0) sketch.forEach((_, i) => (sketch[i] /= norm))
    return sketch
  }

  cosine(a: Float64Array, b: Float64Array): number {
    let dot = 0
    for (let i = 0; i < this.dims; i++) dot += a[i] * b[i]
    return dot
  }
}

export class SemanticIndex {
  readonly sketcher: TokenSketcher
  readonly minSimilarity: number
  readonly maxEntries: number

  private size = 0
  private items = new Array<Float64Array>()
  private keys = new Array<string>()
  private order = new Map<string, number>()

  constructor(config: Partial<SketchConfig> = {}) {
    this.sketcher = new TokenSketcher(config.dims)
    this.minSimilarity = config.minSimilarity ?? DEFAULTS.minSimilarity
    this.maxEntries = config.maxEntries ?? 1024
  }

  put(text: string, key: string) {
    if (this.order.has(key)) {
      this.order.set(key, this.size++)
      return
    }
    if (this.items.length >= this.maxEntries) {
      const evict = this.evictOne()
      if (evict) this.order.delete(evict)
    }
    this.items.push(this.sketcher.toSketch(text))
    this.keys.push(key)
    this.order.set(key, this.size++)
  }

  query(text: string, maxDivergence: number = 0.1): { key: string; divergence: number } | undefined {
    const sketch = this.sketcher.toSketch(text)
    let bestDivergence = Infinity
    let bestKey = ""
    for (let i = 0; i < this.items.length; i++) {
      const sim = this.sketcher.cosine(sketch, this.items[i])
      if (sim < this.minSimilarity) continue
      const divergence = 1 - sim
      if (divergence < bestDivergence && divergence <= maxDivergence) {
        bestDivergence = divergence
        bestKey = this.keys[i]
      }
    }
    if (bestKey) return { key: bestKey, divergence: bestDivergence }
  }

  delete(key: string) {
    const idx = this.items.findIndex((_, i) => this.keys[i] === key)
    if (idx < 0) return
    this.items.splice(idx, 1)
    this.keys.splice(idx, 1)
    this.order.delete(key)
  }

  clear() {
    this.items.length = 0
    this.keys.length = 0
    this.order.clear()
  }

  get length(): number {
    return this.items.length
  }

  private evictOne(): string | undefined {
    let oldestKey = ""
    let oldestTime = Infinity
    for (const [key, time] of this.order) {
      if (time < oldestTime) {
        oldestKey = key
        oldestTime = time
      }
    }
    if (oldestKey) this.delete(oldestKey)
    return oldestKey
  }
}

export function createSemanticIndex(config: Partial<SketchConfig> = {}): SemanticIndex {
  return new SemanticIndex(config)
}
