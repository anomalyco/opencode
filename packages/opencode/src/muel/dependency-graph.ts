export interface DependencyCycle {
  nodes: string[]
  expression: string
}

const DEP_DECL_RE = /(\w+)\s*=\s*(.+)/

function parseExpression(rhs: string): string[] {
  const cleaned = rhs.replace(/[^a-zA-Z0-9_+\-*\/%\s].*$/, "").trim()
  const stripped = cleaned.replace(/[()]/g, " ")
  const tokens = stripped.split(/[\s+\-*\/%]+/)
  return tokens.filter(t => t.length > 0 && /^[a-zA-Z_]\w*$/.test(t))
}

export class DependencyGraph {
  private adj = new Map<string, Set<string>>()
  private expressions = new Map<string, string>()
  private buffer = ""

  declare(from: string, deps: string[], expression: string): void {
    this.expressions.set(from, expression)
    const existing = this.adj.get(from)
    if (existing) {
      for (const d of deps) existing.add(d)
    } else {
      this.adj.set(from, new Set(deps))
    }
  }

  detectCycle(): DependencyCycle | null {
    const WHITE = 0, GRAY = 1, BLACK = 2
    const color = new Map<string, number>()
    const parent = new Map<string, string>()
    const nodes = [...this.adj.keys()]

    for (const n of nodes) color.set(n, WHITE)

    function dfs(u: string, graph: Map<string, Set<string>>): string[] | null {
      color.set(u, GRAY)
      const neighbors = graph.get(u)
      if (neighbors) {
        for (const v of neighbors) {
          if (!color.has(v)) continue
          if (color.get(v) === GRAY) {
            const cycle: string[] = [v, u]
            let cur = parent.get(u)
            while (cur !== undefined && cur !== v) {
              cycle.push(cur)
              cur = parent.get(cur)
            }
            if (cur === v) cycle.push(v)
            return cycle.reverse()
          }
          if (color.get(v) === WHITE) {
            parent.set(v, u)
            const found = dfs(v, graph)
            if (found) return found
          }
        }
      }
      color.set(u, BLACK)
      return null
    }

    for (const n of nodes) {
      if (color.get(n) === WHITE) {
        parent.set(n, "")
        const found = dfs(n, this.adj)
        if (found) {
          const expr = found.map((x) => this.expressions.get(x) || x).join("; ")
          return { nodes: found, expression: expr }
        }
      }
    }
    return null
  }

  hasReversal(): boolean {
    for (const [a, depsA] of this.adj) {
      for (const b of depsA) {
        const depsB = this.adj.get(b)
        if (depsB && depsB.has(a)) return true
      }
    }
    return false
  }

  parseDeclaration(text: string): { from: string; deps: string[]; expression: string } | null {
    const match = text.match(DEP_DECL_RE)
    if (!match) return null
    const from = match[1]
    const rhs = match[2]
    const varNames = parseExpression(rhs)
    const nonNumeric = varNames.filter((v) => isNaN(Number(v)) && v !== from)
    return { from, deps: nonNumeric.length > 0 ? nonNumeric : varNames, expression: `${from} = ${rhs}` }
  }

  feed(chunk: string, cotVars: ReadonlyMap<string, number>): { blocked: boolean; reason?: string } {
    const hasBoundary = /[.!?\n]/.test(chunk)
    if (!hasBoundary) {
      this.buffer += chunk
      return { blocked: false }
    }

    this.buffer += chunk
    const sentences = this.buffer.split(/(?<=[.!?\n])\s*/)
    const lastIsComplete = /[.!?\n]$/.test(this.buffer)

    const completeSentences = lastIsComplete ? sentences : sentences.slice(0, -1)
    for (const raw of completeSentences) {
      const trimmed = raw.trim()
      if (trimmed.length < 3) continue

      const decl = this.parseDeclaration(trimmed)
      if (decl) {
        const validDeps = decl.deps.filter((d) => cotVars.has(d) || isNaN(Number(d)))
        if (validDeps.length > 0) {
          this.declare(decl.from, validDeps, decl.expression)
          const cycle = this.detectCycle()
          if (cycle) {
            return { blocked: true, reason: `Dependency cycle: ${cycle.expression}` }
          }
        }
      }
    }

    if (lastIsComplete) {
      this.buffer = ""
    } else {
      this.buffer = sentences.at(-1) ?? ""
    }

    return { blocked: false }
  }

  getDependencies(varName: string): string[] {
    return [...(this.adj.get(varName) ?? [])]
  }

  clear(): void {
    this.adj.clear()
    this.expressions.clear()
    this.buffer = ""
  }
}
