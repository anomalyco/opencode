import { describe, expect, it } from "bun:test";
import {
  KEYS,
  loadFilter,
  loadProject,
  loadSplitOpen,
  loadSplitPct,
  loadWindow,
  saveFilter,
  saveProject,
  saveSplitOpen,
  saveSplitPct,
  saveWindow,
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
});

describe("persist corrupt defaults", () => {
  it('corrupt "%%%" -> defaults', () => {
    const s = memoryStub({
      [KEYS.graphIdx]: "%%%",
      [KEYS.filter]: "%%%",
      [KEYS.project]: "%%%",
      [KEYS.splitOpen]: "%%%",
    });
    expect(loadWindow(s)).toBe("5m");
    expect(loadFilter(s)).toBe("all");
    expect(loadProject(s)).toBeNull();
    expect(loadSplitOpen(s)).toBe(true);
  });
});

describe("persist no-throw and isolation", () => {
  it("no-arg calls do not throw", () => {
    expect(() => loadWindow()).not.toThrow();
    expect(() => loadFilter()).not.toThrow();
    expect(() => loadProject()).not.toThrow();
    expect(() => loadSplitOpen()).not.toThrow();
    expect(() => saveWindow("5m")).not.toThrow();
    expect(() => saveFilter("all")).not.toThrow();
    expect(() => saveProject("x")).not.toThrow();
    expect(() => saveSplitOpen(true)).not.toThrow();
  });
  it("cross-instance isolation", () => {
    const a = memoryStub();
    const b = memoryStub();
    saveWindow("1h", a);
    expect(loadWindow(a)).toBe("1h");
    expect(loadWindow(b)).toBe("5m");
  });
  it("splitPct round-trips, clamps 25-75, defaults 50", () => {
    const s = memoryStub();
    expect(loadSplitPct(s)).toBe(50);
    saveSplitPct(62, s);
    expect(loadSplitPct(s)).toBe(62);
    saveSplitPct(10, s);
    expect(loadSplitPct(s)).toBe(25);
    saveSplitPct(90, s);
    expect(loadSplitPct(s)).toBe(75);
    saveSplitPct(Number.NaN, s);
    expect(loadSplitPct(s)).toBe(75);
  });
});
