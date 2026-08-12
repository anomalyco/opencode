import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import {
  AbsolutePath,
  decodeAbsolutePath,
  decodeRunReport,
} from "../../src/driver/report.js"

const negotiated = {
  _tag: "Negotiated" as const,
  endpoint: "ws://127.0.0.1:40900",
  role: "ui" as const,
  protocolVersion: 1 as const,
  server: { name: "opencode", version: "2.0.0" },
  capabilities: ["ui.state"],
}

describe("driver report", () => {
  it.effect("brands POSIX and Windows absolute paths", () =>
    Effect.gen(function* () {
      expect(yield* decodeAbsolutePath("/tmp/drive")).toBe("/tmp/drive")
      expect(yield* decodeAbsolutePath("C:\\drive\\output.mp4")).toBe(
        "C:\\drive\\output.mp4",
      )
      expect(yield* decodeAbsolutePath("\\\\server\\share\\output.mp4")).toBe(
        "\\\\server\\share\\output.mp4",
      )
    }),
  )

  it.effect("rejects relative and malformed paths", () =>
    Effect.gen(function* () {
      for (const path of ["tmp/drive", "../drive", "", "C:drive", "/tmp/\0drive"]) {
        expect(Exit.isFailure(yield* Effect.exit(decodeAbsolutePath(path)))).toBe(true)
      }
    }),
  )

  it.effect("decodes a compact structured report", () =>
    Effect.gen(function* () {
      const report = yield* decodeRunReport({
        artifacts: "/tmp/drive",
        retained: true,
        recordings: ["/tmp/output.mp4"],
        compatibility: [negotiated],
      })
      expect(report).toEqual({
        artifacts: AbsolutePath.make("/tmp/drive"),
        retained: true,
        recordings: [AbsolutePath.make("/tmp/output.mp4")],
        compatibility: [negotiated],
      })
    }),
  )
})
