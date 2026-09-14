import { describe, expect, it } from "bun:test";
import { blockedSeconds, permissionPending, ttftSeconds } from "./latency";

describe("ttftSeconds", () => {
  it("computes basic 0.8s", () => {
    expect(
      ttftSeconds({ promptAt: 100, firstPartAt: 100.8, permissionWindows: [] }),
    ).toBeCloseTo(0.8, 9);
  });
  it("subtracts one permission window (100->103 minus 100.5-102 = 1.5)", () => {
    expect(
      ttftSeconds({
        promptAt: 100,
        firstPartAt: 103,
        permissionWindows: [{ askedAt: 100.5, repliedAt: 102 }],
      }),
    ).toBeCloseTo(1.5, 9);
  });
  it("extends open window to firstPart (=1.0)", () => {
    expect(
      ttftSeconds({
        promptAt: 100,
        firstPartAt: 102,
        permissionWindows: [{ askedAt: 101, repliedAt: null }],
      }),
    ).toBeCloseTo(1.0, 9);
  });
  it("returns null for null firstPart", () => {
    expect(
      ttftSeconds({ promptAt: 100, firstPartAt: null, permissionWindows: [] }),
    ).toBeNull();
  });
  it("returns null for promptAt 0", () => {
    expect(
      ttftSeconds({ promptAt: 0, firstPartAt: 10, permissionWindows: [] }),
    ).toBeNull();
  });
  it("unions overlapping windows (100-104 + 102-106 over 100-110 -> 4)", () => {
    const marks = {
      promptAt: 100,
      firstPartAt: 110,
      permissionWindows: [
        { askedAt: 100, repliedAt: 104 },
        { askedAt: 102, repliedAt: 106 },
      ],
    };
    expect(blockedSeconds(marks)).toBeCloseTo(6, 9);
    expect(ttftSeconds(marks)).toBeCloseTo(4, 9);
  });
});

describe("permissionPending", () => {
  it("is true with an open window", () => {
    expect(
      permissionPending({
        promptAt: 1,
        firstPartAt: 2,
        permissionWindows: [{ askedAt: 1.5, repliedAt: null }],
      }),
    ).toBe(true);
  });
  it("is false when all replied", () => {
    expect(
      permissionPending({
        promptAt: 1,
        firstPartAt: 2,
        permissionWindows: [{ askedAt: 1.5, repliedAt: 1.8 }],
      }),
    ).toBe(false);
  });
  it("is false for empty windows", () => {
    expect(
      permissionPending({ promptAt: 1, firstPartAt: 2, permissionWindows: [] }),
    ).toBe(false);
  });
});
