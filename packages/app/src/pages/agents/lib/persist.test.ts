import { describe, expect, it } from "bun:test";
import {
  KEYS,
  isEnabled,
  loadFilter,
  loadProject,
  loadSplitOpen,
  loadWindow,
  saveFilter,
  saveProject,
  saveSplitOpen,
  saveWindow,
  setEnabled,
  type PersistStore,
} from "./persist";

function memoryStub(seed: Record<string, string> = {}): PersistStore & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

describe("persist round-trips", () => {
  it("window round-trip", () => {
    const s = memoryStub();
    saveWindow("1h", s);
    expect(loadWindow(s)).toBe("1h");
  });
  it("filter round-trip", () => {
    const s = memoryStub();
    saveFilter("working", s);
    expect(loadFilter(s)).toBe("working");
  });
  it("project round-trip", () => {
    const s = memoryStub();
    saveProject("my-proj", s);
    expect(loadProject(s)).toBe("my-proj");
    saveProject(null, s);
    expect(loadProject(s)).toBeNull();
  });
  it("splitOpen round-trip", () => {
    const s = memoryStub();
    saveSplitOpen(false, s);
    expect(loadSplitOpen(s)).toBe(false);
    saveSplitOpen(true, s);
    expect(loadSplitOpen(s)).toBe(true);
  });
  it("enabled default false -> true", () => {
    const s = memoryStub();
    expect(isEnabled(s)).toBe(false);
    setEnabled(true, s);
    expect(isEnabled(s)).toBe(true);
    setEnabled(false, s);
    expect(isEnabled(s)).toBe(false);
  });
});

describe("persist corrupt defaults", () => {
  it('corrupt "%%%" -> defaults', () => {
    const s = memoryStub({
      [KEYS.graphIdx]: "%%%",
      [KEYS.filter]: "%%%",
      [KEYS.project]: "%%%",
      [KEYS.splitOpen]: "%%%",
      [KEYS.enabled]: "%%%",
    });
    expect(loadWindow(s)).toBe("5m");
    expect(loadFilter(s)).toBe("all");
    expect(loadProject(s)).toBeNull();
    expect(loadSplitOpen(s)).toBe(true);
    expect(isEnabled(s)).toBe(false);
  });
});

describe("persist no-throw and isolation", () => {
  it("no-arg calls do not throw", () => {
    expect(() => loadWindow()).not.toThrow();
    expect(() => loadFilter()).not.toThrow();
    expect(() => loadProject()).not.toThrow();
    expect(() => loadSplitOpen()).not.toThrow();
    expect(() => isEnabled()).not.toThrow();
    expect(() => saveWindow("5m")).not.toThrow();
    expect(() => saveFilter("all")).not.toThrow();
    expect(() => saveProject("x")).not.toThrow();
    expect(() => saveSplitOpen(true)).not.toThrow();
    expect(() => setEnabled(false)).not.toThrow();
  });
  it("cross-instance isolation", () => {
    const a = memoryStub();
    const b = memoryStub();
    saveWindow("1h", a);
    expect(loadWindow(a)).toBe("1h");
    expect(loadWindow(b)).toBe("5m");
    setEnabled(true, a);
    expect(isEnabled(a)).toBe(true);
    expect(isEnabled(b)).toBe(false);
  });
});
