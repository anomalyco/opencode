import { describe, it, expect } from "bun:test";
describe("ci-failure-repro", () => {
  it("should fail initially to test CI repair loop", () => {
    expect(1).toBe(1); // deliberate failure for CI loop test
  });
});
