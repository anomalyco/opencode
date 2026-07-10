export interface LongTermMemory {
  memory_id: string
  content: string
  token_count: number
  importance: number
  access_count: number
  created_at: number
  last_accessed: number
  retention_score: number
  vector?: number[]
  goal_similarity?: number
  associated_error?: boolean
  user_marked?: boolean
}

export interface WorkingMemory {
  id: string
  content: string
  token_count: number
  priority: number
}

export interface CoreRule {
  rule_id: string
  category: string
  content: string
  token_count: number
  importance: number
}

export interface TransientMemory {
  id: string
  content: string
  token_count: number
  created_at: number
}

export interface AssembledContext {
  l4: CoreRule[]
  l2: WorkingMemory[]
  l3: LongTermMemory[]
  l1: TransientMemory[]
  totalTokens: number
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function jaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)))
  const union = new Set([...wordsA, ...wordsB])
  if (union.size === 0) return 0
  return intersection.size / union.size
}

export interface MemoryDatabase {
  insertMemory(mem: LongTermMemory): void
  getMemories(sessionId: string): LongTermMemory[]
  getAgentSelfRules(): CoreRule[]
  upsertAgentSelfRule(rule: CoreRule): void
  getUserProfiles(userHash?: string): Array<{
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }>
  upsertUserProfile(profile: {
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }): void
}

export class MemorySystem {
  private workingMemories: WorkingMemory[] = []
  private longTermMemories: LongTermMemory[] = []
  private coreRules: CoreRule[] = []
  private transientMemories: TransientMemory[] = []
  private maxTokens = 8000
  private db: MemoryDatabase | null = null

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens
  }

  /** Connect to a persistent database and load stored rules/profiles */
  setDatabase(db: MemoryDatabase): void {
    this.db = db
    // Load persisted core rules (L4)
    const persistedRules = db.getAgentSelfRules()
    for (const rule of persistedRules) {
      this.addCoreRule(rule)
    }
    // Load persisted long-term memories
    const persistedMems = db.getMemories("global")
    for (const mem of persistedMems) {
      this.addLongTermMemory(mem)
    }
  }

  addCoreRule(rule: CoreRule): void {
    const idx = this.coreRules.findIndex((r) => r.rule_id === rule.rule_id)
    if (idx >= 0) {
      this.coreRules[idx] = rule
    } else {
      this.coreRules.push(rule)
    }
    // Persist to DB
    if (this.db) {
      try { this.db.upsertAgentSelfRule(rule) } catch { /* persistence errors must not block */ }
    }
  }

  addWorkingMemory(mem: WorkingMemory): void {
    this.workingMemories.push(mem)
    if (this.workingMemories.length > 20) {
      this.workingMemories = this.workingMemories.slice(-20)
    }
  }

  addLongTermMemory(mem: LongTermMemory): void {
    const idx = this.longTermMemories.findIndex((m) => m.memory_id === mem.memory_id)
    if (idx >= 0) {
      this.longTermMemories[idx] = mem
    } else {
      this.longTermMemories.push(mem)
    }
    // Persist to DB
    if (this.db) {
      try { this.db.insertMemory(mem) } catch { /* persistence errors must not block */ }
    }
    if (this.longTermMemories.length > 1000) {
      this.longTermMemories.sort((a, b) => b.retention_score - a.retention_score)
      this.longTermMemories = this.longTermMemories.slice(0, 500)
    }
  }

  addTransient(content: string, tokenCount: number): void {
    this.transientMemories.push({
      id: `t_${Date.now()}`,
      content,
      token_count: tokenCount,
      created_at: Date.now(),
    })
    if (this.transientMemories.length > 10) {
      this.transientMemories = this.transientMemories.slice(-10)
    }
  }

  clearTransient(): void {
    this.transientMemories = []
  }

  calculateImportance(memory: LongTermMemory): number {
    const userExplicit = memory.user_marked ? 1.0 : 0.0
    const errorRelated = memory.associated_error ? 1.0 : 0.0
    const goalRelated = memory.goal_similarity ?? 0.5
    const frequency = Math.min(1.0, memory.access_count / 10)
    const recency = Math.exp(-(Date.now() - memory.created_at) / 86400000)

    return 0.3 * userExplicit + 0.25 * errorRelated + 0.2 * goalRelated + 0.15 * frequency + 0.1 * recency
  }

  calculateRetention(memory: LongTermMemory, now: number = Date.now()): number {
    const tHours = (now - memory.created_at) / 3600000
    const n = memory.access_count
    const S = 24
    const alpha = 0.3
    const beta = 0.5 + memory.importance * 0.5

    const S_eff = S * (1 + alpha * n)
    const R = Math.exp(-tHours / S_eff) * beta

    return Math.max(0.05, Math.min(1.0, R))
  }

  compositeRetrievalScore(
    memory: LongTermMemory,
    queryVector: number[] | null,
    currentGoal: string,
  ): number {
    const vectorSim = queryVector
      ? cosineSimilarity(memory.vector ?? [], queryVector)
      : jaccardSimilarity(memory.content, currentGoal)
    const importance = this.calculateImportance(memory)
    const retention = this.calculateRetention(memory)

    return 0.4 * vectorSim + 0.3 * importance + 0.3 * retention
  }

  assembleContext(currentGoal: string, queryVector: number[] | null = null): AssembledContext {
    let remaining = this.maxTokens

    const l4Tokens = this.coreRules.reduce((s, r) => s + r.token_count, 0)
    const l4Budget = Math.min(l4Tokens, 600)
    remaining -= l4Budget

    const l2Tokens = this.workingMemories.reduce((s, m) => s + m.token_count, 0)
    const l2Budget = Math.min(l2Tokens, 1200)
    remaining -= l2Budget

    const l1Budget = 500
    remaining -= l1Budget

    const l3Budget = remaining

    this.longTermMemories.forEach((m) => {
      m.importance = this.calculateImportance(m)
      m.retention_score = this.calculateRetention(m)
    })

    const scored = this.longTermMemories
      .map((m) => ({
        memory: m,
        score: this.compositeRetrievalScore(m, queryVector, currentGoal),
      }))
      .sort((a, b) => b.score - a.score)

    const selectedL3: LongTermMemory[] = []
    let usedL3 = 0
    for (const { memory } of scored) {
      if (usedL3 + memory.token_count > l3Budget) break
      selectedL3.push(memory)
      usedL3 += memory.token_count
      memory.access_count++
      memory.last_accessed = Date.now()
    }

    return {
      l4: this.coreRules.slice(0, Math.max(1, Math.floor(l4Budget / 50))),
      l2: this.workingMemories.slice(-Math.max(1, Math.floor(l2Budget / 100))),
      l3: selectedL3,
      l1: this.transientMemories.slice(-5),
      totalTokens: l4Budget + l2Budget + l1Budget + usedL3,
    }
  }
}

export * as Memory from "./memory"
