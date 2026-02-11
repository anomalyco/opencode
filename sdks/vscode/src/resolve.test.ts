import { describe, expect, test } from "bun:test";
import { resolve } from "./resolve";

const noop = async () => undefined;

describe("resolve", () => {
  test("active terminal with port returns native", async () => {
    const result = await resolve([{ port: 12345, active: true }], "/workspace", noop);
    expect(result).toEqual({ action: "native", port: 12345 });
  });

  test("prefers active terminal over non-active", async () => {
    const result = await resolve(
      [
        { port: 111, active: false },
        { port: 222, active: true },
      ],
      "/workspace",
      noop,
    );
    expect(result).toEqual({ action: "native", port: 222 });
  });

  test("non-active terminal with port returns native", async () => {
    const result = await resolve([{ active: true }, { port: 54321, active: false }], "/workspace", noop);
    expect(result).toEqual({ action: "native", port: 54321 });
  });

  test("external instance with matching CWD returns external", async () => {
    const result = await resolve([], "/workspace", async () => 4096);
    expect(result).toEqual({ action: "external", port: 4096 });
  });

  test("external instance with non-matching CWD returns spawn", async () => {
    const result = await resolve([], "/workspace", noop);
    expect(result).toEqual({ action: "spawn" });
  });

  test("no workspace skips discovery and returns spawn", async () => {
    const result = await resolve([], undefined, async () => 4096);
    expect(result).toEqual({ action: "spawn" });
  });

  test("no terminals and no external returns spawn", async () => {
    const result = await resolve([], undefined, noop);
    expect(result).toEqual({ action: "spawn" });
  });

  test("native preferred over external", async () => {
    const result = await resolve([{ port: 9999, active: false }], "/workspace", async () => 4096);
    expect(result).toEqual({ action: "native", port: 9999 });
  });

  test("terminals without ports fall through to external", async () => {
    const result = await resolve([{ active: true }, { active: false }], "/workspace", async () => 4096);
    expect(result).toEqual({ action: "external", port: 4096 });
  });
});
