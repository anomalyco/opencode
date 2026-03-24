import { describe, expect, test } from "bun:test"
import { infer } from "./browser-url"

describe("infer", () => {
  test("prefers explicit next port from scripts", () => {
    expect(
      infer({
        pkg: {
          scripts: {
            dev: "next dev --port 4010",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
      }).slice(0, 2),
    ).toEqual(["http://localhost:4010", "http://localhost:3000"])
  })

  test("uses framework defaults when no port is declared", () => {
    expect(
      infer({
        pkg: {
          scripts: {
            dev: "bun run dev",
          },
          dependencies: {
            next: "15.0.0",
          },
        },
      })[0],
    ).toBe("http://localhost:3000")
  })

  test("keeps explicit localhost urls", () => {
    expect(
      infer({
        cmd: "open http://127.0.0.1:8787/app",
      })[0],
    ).toBe("http://127.0.0.1:8787/app")
  })
})
