/*
 * profile.ts - the learner profile for Code Coach.
 *
 * Persistent, local, file-based so the same rules run in tests and in the
 * extension. Each interaction appends one record per concept tag that fired.
 * The read model is counts + a "mastered" set, used by the triage engine to
 * stop re-teaching and to deepen on repetition.
 */

import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Record {
  ts: number;
  finding: string;
  tags: string[];
}

export interface Snapshot {
  counts: Record<string, number>;
  mastered: string[];
}

const MASTERED_AT = 3; // third hit on a concept is the "still repeating" signal.

export class Profile {
  private file: string;

  constructor(file: string) {
    this.file = file;
    try {
      appendFileSync(this.file, "", "utf8");
    } catch {
      // create dir lazily on first write
    }
  }

  record(finding: string, tags: string[]): void {
    const rec: Record = { ts: Date.now(), finding, tags };
    try {
      appendFileSync(this.file, JSON.stringify(rec) + "\n", "utf8");
    } catch {
      // append-only best effort; a write failure must not block the IDE
    }
  }

  snapshot(): Snapshot {
    const counts: Record<string, number> = {};
    try {
      const raw = readFileSync(this.file, "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let rec: Record;
        try {
          rec = JSON.parse(t);
        } catch {
          continue;
        }
        for (const tag of rec.tags) {
          counts[tag] = (counts[tag] ?? 0) + 1;
        }
      }
    } catch {
      return { counts: {}, mastered: [] };
    }
    const mastered = Object.entries(counts)
      .filter(([, n]) => n >= MASTERED_AT)
      .map(([k]) => k);
    return { counts, mastered };
  }

  // Returns true when a finding whose tag list hits a mastered concept should
  // deepen its nudge rather than be a fresh lesson.
  shouldDeepen(tags: string[], counts: Record<string, number>): boolean {
    return tags.some((t) => (counts[t] ?? 0) >= MASTERED_AT);
  }

  // A path this profile lives at; helpers use it for tests.
  static pathOf(dir: string): string {
    return join(dirname(dir), "profile.jsonl");
  }
}
