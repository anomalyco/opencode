import * as fs from "node:fs/promises";
import * as path from "node:path";

export type SessionRecordKind =
  | "meta"
  | "user"
  | "assistant"
  | "tool"
  | "event";

export interface SessionRecord {
  ts: number;
  kind: SessionRecordKind;
  payload: unknown;
}

export interface SessionSummary {
  id: string;
  file: string;
  mtimeMs: number;
  title: string;
  sizeBytes: number;
}

function sessionId(date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${rand}`;
}

export class SessionStore {
  private readonly dir: string;
  private currentId: string | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  get sessionsDir(): string {
    return this.dir;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async start(title?: string): Promise<string> {
    await this.ensureDir();
    this.currentId = sessionId();
    if (title && title.trim().length > 0) {
      await this.append({
        ts: Date.now(),
        kind: "meta",
        payload: { title: title.trim().slice(0, 120) },
      });
    }
    return this.currentId;
  }

  async append(record: SessionRecord): Promise<void> {
    const id = this.currentId ?? (await this.start());
    const line = `${JSON.stringify({ ...record, id })}\n`;
    await fs.appendFile(this.sessionPath(id), line, "utf8");
  }

  sessionPath(id: string): string {
    return path.join(this.dir, `${id}.jsonl`);
  }

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const names = await fs.readdir(this.dir);
    const summaries: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const full = path.join(this.dir, name);
      const stat = await fs.stat(full);
      summaries.push({
        id: name.slice(0, -".jsonl".length),
        file: full,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        title: "",
      });
    }
    summaries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const summary of summaries) {
      try {
        const raw = await fs.readFile(summary.file, "utf8");
        const firstLine = raw.split("\n", 1)[0] ?? "";
        const parsed = JSON.parse(firstLine) as { payload?: { title?: string } };
        summary.title =
          parsed.payload?.title ??
          firstUserPrompt(raw) ??
          "(empty session)";
      } catch {
        summary.title = "(unreadable session)";
      }
    }
    return summaries;
  }

  async load(id: string): Promise<SessionRecord[]> {
    const raw = await fs.readFile(this.sessionPath(id), "utf8");
    const records: SessionRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Tolerate corrupt/partial lines (e.g. a crash mid-append): skip them
      // instead of failing to load the whole session.
      try {
        records.push(JSON.parse(trimmed) as SessionRecord);
      } catch {
        continue;
      }
    }
    return records;
  }
}

function firstUserPrompt(raw: string): string | undefined {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as SessionRecord;
      if (
        rec.kind === "user" &&
        typeof rec.payload === "object" &&
        rec.payload !== null &&
        "text" in rec.payload
      ) {
        return String((rec.payload as { text: unknown }).text).slice(0, 120);
      }
    } catch {
      continue;
    }
  }
  return undefined;
}
