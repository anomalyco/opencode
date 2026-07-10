import type { DAG } from "./dag"
import type { EngineDatabase } from "./db/engine-database"

export interface L1Snapshot {
  state_machine: {
    current_state: string
    previous_state: string
    transition_count: number
  }
  dag_progress: {
    version: number
    total_nodes: number
    completed_nodes: number
    failed_nodes: number
    node_statuses: Record<string, "pending" | "running" | "completed" | "failed" | "blocked">
  }
  pending_queue: string[]
  workspace_hash: string
}

export interface MessageRef {
  event_id: string
  sequence_index: number
  summary: string
  token_count: number
}

export interface FileContextRef {
  file_path: string
  content_hash: string
  relevant_lines: [number, number]
  summary: string
}

export interface ContextSummary {
  system_prompt_ref: string
  key_conclusions: Array<{ text: string; confidence: number }>
  recent_messages: MessageRef[]
  file_contexts: FileContextRef[]
}

export interface MemoryPointer {
  memory_id: string
  memory_type: "session" | "agent_self" | "user_profile"
  relevance_score: number
}

export interface L2Snapshot {
  l1_data: L1Snapshot
  context_summary: ContextSummary
  dag_full: DAG
  memory_pointers: MemoryPointer[]
}

export interface L3Snapshot {
  l2_data: L2Snapshot
  archive_reference: {
    archive_path: string
    event_count: number
    sequence_range: [number, number]
  }
  session_metadata: SessionMeta
}

export interface SessionMeta {
  title: string
  goal: string
  total_events: number
  total_tokens: number
  duration_ms: number
  created_at: number
  completed_at?: number
}

export interface Checkpoint {
  checkpoint_id: string
  session_id: string
  last_event_id: string
  level: "L1" | "L2" | "L3"
  execution_state: Record<string, unknown>
  context_hash: string
  git_head_hash?: string
  created_at: number
}

export class CheckpointManager {
  private l1Checkpoints: Checkpoint[] = []
  private l2Checkpoints: Checkpoint[] = []
  private l3Checkpoints: Checkpoint[] = []
  private readonly MAX_L1 = 10
  private readonly MAX_L2 = 5
  private db: EngineDatabase | null = null

  /** Size limits in bytes per spec §11.2 */
  static readonly L1_MAX_BYTES = 50 * 1024     // 50 KB
  static readonly L2_MAX_BYTES = 200 * 1024    // 200 KB
  static readonly L3_MAX_BYTES = 10 * 1024     // 10 KB

  setDatabase(db: EngineDatabase): void {
    this.db = db
  }

  private persist(cp: Checkpoint): void {
    if (this.db && this.db.isConnected()) {
      this.db.insertCheckpoint(cp)
    }
  }

  createL1(sessionId: string, snapshot: L1Snapshot, contextHash: string, lastEventId: string): Checkpoint {
    const sizeBytes = this.getCheckpointSize(snapshot)
    const sizeCheck = this.validateSize("L1", sizeBytes)
    if (!sizeCheck.ok) {
      // Warn but still create — truncation is advisory
      console.warn(`[CheckpointManager] ${sizeCheck.warning}`)
    }

    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L1`,
      session_id: sessionId,
      last_event_id: lastEventId,
      level: "L1",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      created_at: Date.now(),
    }
    this.l1Checkpoints.push(cp)
    if (this.l1Checkpoints.length > this.MAX_L1) {
      this.l1Checkpoints = this.l1Checkpoints.slice(-this.MAX_L1)
    }
    this.persist(cp)
    return cp
  }

  createL2(
    sessionId: string,
    snapshot: L2Snapshot,
    contextHash: string,
    gitHeadHash: string,
    lastEventId: string,
  ): Checkpoint {
    const sizeBytes = this.getCheckpointSize(snapshot)
    const sizeCheck = this.validateSize("L2", sizeBytes)
    if (!sizeCheck.ok) {
      console.warn(`[CheckpointManager] ${sizeCheck.warning}`)
    }

    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L2`,
      session_id: sessionId,
      last_event_id: lastEventId,
      level: "L2",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      git_head_hash: gitHeadHash,
      created_at: Date.now(),
    }
    this.l2Checkpoints.push(cp)
    if (this.l2Checkpoints.length > this.MAX_L2) {
      this.l2Checkpoints = this.l2Checkpoints.slice(-this.MAX_L2)
    }
    this.persist(cp)
    return cp
  }

  createL3(sessionId: string, snapshot: L3Snapshot, contextHash: string): Checkpoint {
    const cp: Checkpoint = {
      checkpoint_id: `cp_${Date.now()}_L3`,
      session_id: sessionId,
      last_event_id: "",
      level: "L3",
      execution_state: snapshot as unknown as Record<string, unknown>,
      context_hash: contextHash,
      created_at: Date.now(),
    }
    this.l3Checkpoints.push(cp)
    this.persist(cp)
    return cp
  }

  getLatest(level?: "L1" | "L2" | "L3"): Checkpoint | null {
    if (level === "L1") return this.l1Checkpoints.at(-1) ?? this.db?.getLatestCheckpoint("", "L1") ?? null
    if (level === "L2") return this.l2Checkpoints.at(-1) ?? this.db?.getLatestCheckpoint("", "L2") ?? null
    if (level === "L3") return this.l3Checkpoints.at(-1) ?? this.db?.getLatestCheckpoint("", "L3") ?? null

    return this.l1Checkpoints.at(-1)
      ?? this.l2Checkpoints.at(-1)
      ?? this.l3Checkpoints.at(-1)
      ?? this.db?.getLatestCheckpoint("") ?? null
  }

  getCheckpointSize(snapshot: L1Snapshot | L2Snapshot | L3Snapshot): number {
    return new TextEncoder().encode(JSON.stringify(snapshot)).length
  }

  /** Returns size warning if checkpoint exceeds its tier limit */
  validateSize(level: "L1" | "L2" | "L3", sizeBytes: number): { ok: boolean; sizeBytes: number; limitBytes: number; warning?: string } {
    const limits = { L1: CheckpointManager.L1_MAX_BYTES, L2: CheckpointManager.L2_MAX_BYTES, L3: CheckpointManager.L3_MAX_BYTES }
    const limitBytes = limits[level]
    if (sizeBytes > limitBytes) {
      return {
        ok: false,
        sizeBytes,
        limitBytes,
        warning: `${level} checkpoint ${(sizeBytes / 1024).toFixed(1)}KB exceeds ${(limitBytes / 1024).toFixed(0)}KB limit. Use MessageRef pointers instead of inline data.`,
      }
    }
    return { ok: true, sizeBytes, limitBytes }
  }

  getAllCheckpoints(): Checkpoint[] {
    return [...this.l1Checkpoints, ...this.l2Checkpoints, ...this.l3Checkpoints]
  }

  clear(): void {
    this.l1Checkpoints = []
    this.l2Checkpoints = []
    this.l3Checkpoints = []
  }
}

export * as Checkpoint from "./checkpoint"
