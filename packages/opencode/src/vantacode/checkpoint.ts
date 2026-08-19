/**
 * Lightweight checkpoint / rewind for VantaCode edits.
 *
 * Before every edit the agent snapshots the file contents. A checkpoint groups
 * the snapshots taken during one turn so the user can undo an entire turn's
 * changes without relying on git. Snapshots are held in memory and can be
 * persisted to a JSON file for session resume.
 */

import fs from "node:fs"
import path from "node:path"

export interface FileSnapshot {
  readonly filePath: string
  /** File contents before the edit; null means the file did not exist. */
  readonly before: string | null
}

export interface TurnCheckpoint {
  readonly id: number
  readonly label: string
  readonly createdAt: number
  readonly snapshots: FileSnapshot[]
}

export class CheckpointStore {
  private checkpoints: TurnCheckpoint[] = []
  private pending: FileSnapshot[] = []
  private nextId = 1

  /** Snapshot a file's current contents before it is edited. */
  snapshot(filePath: string): void {
    const abs = path.resolve(filePath)
    // Don't double-snapshot the same file within one turn.
    if (this.pending.some((s) => s.filePath === abs)) return
    let before: string | null = null
    try {
      before = fs.readFileSync(abs, "utf8")
    } catch {
      before = null
    }
    this.pending.push({ filePath: abs, before })
  }

  /** Commit the pending snapshots as one checkpoint for the just-finished turn. */
  commit(label: string): TurnCheckpoint | undefined {
    if (this.pending.length === 0) return undefined
    const checkpoint: TurnCheckpoint = {
      id: this.nextId++,
      label,
      createdAt: Date.now(),
      snapshots: this.pending,
    }
    this.checkpoints.push(checkpoint)
    this.pending = []
    return checkpoint
  }

  list(): TurnCheckpoint[] {
    return [...this.checkpoints]
  }

  /** Restore the files captured in a checkpoint to their "before" state. */
  private restore(checkpoint: TurnCheckpoint): string[] {
    const restored: string[] = []
    for (const snap of checkpoint.snapshots) {
      try {
        if (snap.before === null) {
          if (fs.existsSync(snap.filePath)) fs.rmSync(snap.filePath)
        } else {
          fs.mkdirSync(path.dirname(snap.filePath), { recursive: true })
          fs.writeFileSync(snap.filePath, snap.before, "utf8")
        }
        restored.push(snap.filePath)
      } catch {
        // best effort; keep going
      }
    }
    return restored
  }

  /** Undo the most recent checkpoint. */
  rewindLast(): { checkpoint: TurnCheckpoint; restored: string[] } | undefined {
    const checkpoint = this.checkpoints.pop()
    if (!checkpoint) return undefined
    return { checkpoint, restored: this.restore(checkpoint) }
  }

  /** Undo every checkpoint at or after `id` (newest first). */
  rewindTo(id: number): { restored: string[]; count: number } {
    const restored: string[] = []
    let count = 0
    while (this.checkpoints.length > 0) {
      const top = this.checkpoints[this.checkpoints.length - 1]
      if (top.id < id) break
      const popped = this.checkpoints.pop()
      if (!popped) break
      restored.push(...this.restore(popped))
      count++
    }
    return { restored, count }
  }

  /** Persist checkpoints to disk for session resume. */
  persist(filePath: string): void {
    const abs = path.resolve(filePath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify({ nextId: this.nextId, checkpoints: this.checkpoints }, null, 2), "utf8")
  }

  /** Load a persisted checkpoint file. */
  static load(filePath: string): CheckpointStore {
    const store = new CheckpointStore()
    try {
      const raw = fs.readFileSync(path.resolve(filePath), "utf8")
      const parsed = JSON.parse(raw) as { nextId?: number; checkpoints?: TurnCheckpoint[] }
      store.checkpoints = parsed.checkpoints ?? []
      store.nextId = parsed.nextId ?? store.checkpoints.length + 1
    } catch {
      // fresh store
    }
    return store
  }
}
