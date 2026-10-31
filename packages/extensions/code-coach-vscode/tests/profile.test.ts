import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profile } from "../src/profile";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "code-coach-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const pathOf = (name: string) => join(dir, name);

describe("profile", () => {
  test("empty profile -> empty counts", () => {
    const p = new Profile(pathOf("probe.jsonl"));
    const s = p.snapshot();
    expect(s.counts).toEqual({});
    expect(s.mastered).toEqual([]);
  });

  test("record and count", () => {
    const p = new Profile(pathOf("probe.jsonl"));
    p.record("plaintext-password", ["password-hashing"]);
    p.record("plaintext-password", ["password-hashing"]);
    const s = p.snapshot();
    expect(s.counts["password-hashing"]).toBe(2);
  });

  test("third hit marks the concept mastered", () => {
    const p = new Profile(pathOf("probe.jsonl"));
    for (let i = 0; i < 3; i++) {
      p.record("plaintext-password", ["password-hashing"]);
    }
    expect(p.snapshot().mastered).toEqual(["password-hashing"]);
  });

  test("deepen flag turns on after mastered", () => {
    const p = new Profile(pathOf("probe.jsonl"));
    for (let i = 0; i < 3; i++) {
      p.record("xss", ["xss"]);
    }
    const { counts } = p.snapshot();
    expect(p.shouldDeepen(["xss"], counts)).toBe(true);
  });
});
