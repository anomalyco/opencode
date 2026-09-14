import { describe, expect, it } from "bun:test";
import {
  RATE_MIN_OUT,
  cacheShare,
  isRateWorthy,
  latText,
  money,
  pctText,
  rateText,
  tok,
  tokTotal,
} from "./format";

describe("tok (TokenFloat parity)", () => {
  it("formats sub-1000 as integers", () => {
    expect(tok(999)).toBe("999");
    expect(tok(0)).toBe("0");
  });
  it("formats kilo with one decimal", () => {
    expect(tok(12400)).toBe("12.4k");
  });
  it("rounds 999960 up to 1.0M", () => {
    expect(tok(999960)).toBe("1.0M");
  });
  it("maps nonfinite to em dash", () => {
    expect(tok(NaN)).toBe("—");
    expect(tok(Infinity)).toBe("—");
    expect(tok(-Infinity)).toBe("—");
  });
});

describe("rateText", () => {
  it("formats sub-10 with one decimal", () => {
    expect(rateText(8.37)).toBe("8.4");
  });
  it("maps null to em dash", () => {
    expect(rateText(null)).toBe("—");
  });
  it("formats integers >= 10", () => {
    expect(rateText(10)).toBe("10");
  });
  it("clamps above 9999", () => {
    expect(rateText(12345)).toBe("9999");
  });
  it("maps zero and nonfinite to em dash", () => {
    expect(rateText(0)).toBe("—");
    expect(rateText(NaN)).toBe("—");
    expect(rateText(Infinity)).toBe("—");
    expect(rateText(undefined)).toBe("—");
  });
});

describe("money", () => {
  it("formats dollars with two decimals", () => {
    expect(money(41.2)).toBe("41.20");
    expect(money(-41.2)).toBe("-41.20");
  });
  it("formats millions compact", () => {
    expect(money(1234567)).toBe("1.23M");
  });
  it("formats zero", () => {
    expect(money(0)).toBe("0.00");
  });
  it("maps NaN to em dash and infinities to capped billions", () => {
    expect(money(NaN)).toBe("—");
    expect(money(Infinity)).toBe("999B+");
    expect(money(-Infinity)).toBe("-999B+");
  });
});

describe("pctText", () => {
  it("floors fractional percent", () => {
    expect(pctText(99.5)).toBe("99%");
  });
  it("formats whole percent", () => {
    expect(pctText(70)).toBe("70%");
  });
  it("maps nonfinite to em dash", () => {
    expect(pctText(NaN)).toBe("—");
    expect(pctText(Infinity)).toBe("—");
  });
});

describe("latText", () => {
  it("maps null to em dash", () => {
    expect(latText(null)).toBe("—");
  });
  it("formats sub-second as ms", () => {
    expect(latText(0.84)).toBe("840ms");
    expect(latText(0)).toBe("0ms");
  });
  it("formats seconds", () => {
    expect(latText(12.3)).toBe("12s");
  });
  it("caps at 99s+", () => {
    expect(latText(150)).toBe("99s+");
  });
  it("maps nonfinite and undefined to em dash", () => {
    expect(latText(NaN)).toBe("—");
    expect(latText(Infinity)).toBe("—");
    expect(latText(undefined)).toBe("—");
  });
});

describe("thresholds and totals", () => {
  it("exposes RATE_MIN_OUT=50", () => {
    expect(RATE_MIN_OUT).toBe(50);
  });
  it("gates rate-worthiness at 50", () => {
    expect(isRateWorthy(49)).toBe(false);
    expect(isRateWorthy(50)).toBe(true);
  });
  it("sums token totals", () => {
    expect(tokTotal({ input: 100, output: 50, reasoning: 25 })).toBe(175);
  });
  it("computes cache share", () => {
    expect(cacheShare({ input: 100, cache: { read: 25 } })).toBe(0.25);
    expect(cacheShare({ input: 0, cache: { read: 10 } })).toBe(0);
  });
});
