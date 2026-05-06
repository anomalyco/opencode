import type { TrieConfig, TrieMatch } from "./schema"

class PrefixTrie {
  readonly maxDepth: number
  readonly maxEntries: number
  readonly breakevenPrefixLen: number

  private root: TrieNode
  private nodeCount = 0

  constructor(config: Partial<TrieConfig> = {}) {
    this.maxDepth = config.maxDepth ?? 64
    this.maxEntries = config.maxEntries ?? 256
    this.breakevenPrefixLen = config.breakevenPrefixLen ?? 32
    this.root = { children: new Map(), depth: 0 }
    this.nodeCount = 1
  }

  *segments(text: string): Generator<string> {
    const msgLen = text.split("\n").length
    yield String(msgLen)
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length
      yield `${i}:${lineLen}`
      yield `${i}:h${Math.abs(djb2(lines[i].slice(0, 128)))}`
    }
  }

  insert(segments: string[], entryKey: string): void {
    let node = this.root
    for (let i = 0; i < segments.length && i < this.maxDepth; i++) {
      const seg = segments[i]
      let child = node.children.get(seg)
      if (!child) {
        child = { children: new Map(), depth: i + 1 }
        node.children.set(seg, child)
        this.nodeCount++
        if (this.nodeCount > this.maxEntries) {
          this.truncate()
          return
        }
      }
      node = child
    }
    node.entryKey = entryKey
  }

  match(segments: string[]): TrieMatch | undefined {
    let node = this.root
    let depth = 0
    for (let i = 0; i < segments.length && i < this.maxDepth; i++) {
      const seg = segments[i]
      const child = node.children.get(seg)
      if (!child) break
      node = child
      depth++
    }
    if (node.entryKey && depth >= this.breakevenPrefixLen / 4) {
      const prefixLen = Math.min(depth, segments.length)
      return { key: node.entryKey, prefixLength: prefixLen, totalLength: segments.length }
    }
    if (node.entryKey) return { key: node.entryKey, prefixLength: depth, totalLength: segments.length }
  }

  delete(segments: string[]): void {
    const path: Array<{ node: TrieNode; seg: string }> = []
    let node = this.root
    for (let i = 0; i < segments.length && i < this.maxDepth; i++) {
      const seg = segments[i]
      const child = node.children.get(seg)
      if (!child) return
      path.push({ node, seg })
      node = child
    }
    node.entryKey = undefined
    for (let i = path.length - 1; i >= 0; i--) {
      const { node: parent, seg } = path[i]
      const child = parent.children.get(seg)
      if (child && child.children.size === 0 && !child.entryKey) {
        parent.children.delete(seg)
        this.nodeCount--
      } else {
        break
      }
    }
  }

  clear(): void {
    this.root = { children: new Map(), depth: 0 }
    this.nodeCount = 1
  }

  get size(): number {
    return this.nodeCount
  }

  private truncate(): void {
    let smallest = ""
    let smallestDepth = Infinity
    const walk = (n: TrieNode) => {
      for (const [seg, child] of n.children) {
        if (child.depth !== undefined && child.entryKey && child.children.size === 0 && child.depth < smallestDepth) {
          smallestDepth = child.depth
          smallest = seg
        }
        walk(child)
      }
    }
    walk(this.root)
    if (smallest && this.root.children.has(smallest)) {
      this.root.children.delete(smallest)
      this.nodeCount--
    }
  }
}

interface TrieNode {
  children: Map<string, TrieNode>
  entryKey?: string
  depth: number
}

function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return hash
}

export function createPrefixTrie(config: Partial<TrieConfig> = {}): PrefixTrie {
  return new PrefixTrie(config)
}
