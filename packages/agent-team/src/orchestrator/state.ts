import path from "path"
import fs from "fs"

type WAL = { seq: number; op: string; data: unknown; ts: number }

export class StateManager {
  private statePath: string
  private walPath: string
  private seq = 0
  private snapshotTs = 0

  constructor(dir: string) {
    this.statePath = path.join(dir, "state.json")
    this.walPath = path.join(dir, "wal.jsonl")
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.statePath), { recursive: true })
  }

  async saveSnapshot(state: Record<string, unknown>): Promise<void> {
    const snap = { snapshot_time: Date.now(), ...state }
    await fs.promises.writeFile(this.statePath, JSON.stringify(snap, null, 2))
    this.snapshotTs = snap.snapshot_time
  }

  async loadSnapshot(): Promise<Record<string, unknown> | undefined> {
    try {
      const content = await fs.promises.readFile(this.statePath, "utf-8")
      const parsed = JSON.parse(content)
      this.snapshotTs = parsed.snapshot_time ?? 0
      return parsed
    } catch {
      return undefined
    }
  }

  async appendWAL(entry: { op: string; data: unknown }): Promise<number> {
    this.seq++
    const walEntry: WAL = { seq: this.seq, op: entry.op, data: entry.data, ts: Date.now() }
    await fs.promises.appendFile(this.walPath, JSON.stringify(walEntry) + "\n")
    return this.seq
  }

  async recover(): Promise<Record<string, unknown>> {
    let state = await this.loadSnapshot()
    const walEntries = await this.readWAL()
    if (walEntries.length > 0) {
      this.seq = walEntries[walEntries.length - 1].seq
    }
    const relevant = state ? walEntries.filter((e) => e.ts > this.snapshotTs) : walEntries
    for (const entry of relevant) {
      state = this.applyWAL(state ?? {}, entry)
    }
    if (relevant.length > 0) {
      await this.saveSnapshot(state ?? {})
      await this.compact()
    }
    return state ?? {}
  }

  private async readWAL(): Promise<WAL[]> {
    try {
      const content = await fs.promises.readFile(this.walPath, "utf-8")
      return content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as WAL)
    } catch {
      return []
    }
  }

  private applyWAL(state: Record<string, unknown>, entry: WAL): Record<string, unknown> {
    return { ...state, [entry.op]: entry.data }
  }

  async compact(): Promise<void> {
    await fs.promises.writeFile(this.walPath, "")
  }

  snapshotTime(): number {
    return this.snapshotTs
  }
}
