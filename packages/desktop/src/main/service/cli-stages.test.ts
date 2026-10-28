import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { cleanStages } from "./cli-stages"
import { keptStages, stageName } from "./cli-version"

describe("cleanStages", () => {
  test.each([
    { name: "upgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.20" },
    { name: "downgrade", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.18" },
    { name: "prerelease", staged: ["2.0.20", "2.1.0-beta.1", "local"], current: "2.1.0-beta.1" },
    { name: "adopted server", staged: ["2.0.18", "2.0.19", "2.0.20"], current: "2.0.20", keep: ["2.0.19"] },
  ])("keeps only the current and adopted staged CLIs after $name", async (input) => {
    const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-stages-"))

    try {
      input.staged.forEach((version) => {
        mkdirSync(path.join(root, version))
        writeFileSync(path.join(root, version, "opencode-cli"), version)
      })
      writeFileSync(path.join(root, "unrelated"), "")

      await Effect.runPromise(
        cleanStages(path.join(root, input.current, "opencode-cli"), { keep: input.keep }).pipe(
          Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        ),
      )

      expect(readdirSync(root).sort()).toEqual([input.current, ...(input.keep ?? []), "unrelated"].sort())
      expect(readdirSync(path.join(root, input.current))).toEqual(["opencode-cli"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([{ running: "2.0.19" }, { running: "2.0.20" }, { running: undefined }])(
    "preserves other channels and legacy executables while keeping owner $running",
    async (input) => {
      const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-channel-stages-"))
      const current = path.join(root, stageName("2.0.20", "prod", "x64"), "opencode-cli")
      const other = path.join(root, stageName("2.0.20", "latest", "x64"), "opencode-cli")
      const legacy = path.join(root, "2.0.20-x64", "opencode-cli")
      const adopted = path.join(root, stageName("2.0.19", "prod", "x64"), "opencode-cli")
      const obsolete = path.join(root, stageName("2.0.18", "prod", "x64"), "opencode-cli")

      try {
        for (const [file, bytes] of [
          [other, "latest"],
          [legacy, "legacy"],
          [adopted, "adopted"],
          [obsolete, "obsolete"],
        ]) {
          mkdirSync(path.dirname(file), { recursive: true })
          writeFileSync(file, bytes)
        }

        expect(existsSync(current)).toBe(false)
        mkdirSync(path.dirname(current), { recursive: true })
        writeFileSync(current, "prod")

        await Effect.runPromise(
          cleanStages(current, { keep: keptStages("2.0.20", input.running, "x64") }).pipe(
            Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
          ),
        )

        expect(readFileSync(current, "utf8")).toBe("prod")
        expect(readFileSync(other, "utf8")).toBe("latest")
        expect(readFileSync(legacy, "utf8")).toBe("legacy")
        expect(existsSync(adopted)).toBe(input.running === "2.0.19")
        expect(existsSync(obsolete)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  test("does not reuse a cached executable for another architecture", () => {
    const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-arch-stages-"))
    const cached = path.join(root, stageName("2.0.20", "prod", "x64"), "opencode-cli")
    const requested = path.join(root, stageName("2.0.20", "prod", "arm64"), "opencode-cli")

    try {
      mkdirSync(path.dirname(cached), { recursive: true })
      writeFileSync(cached, "x64")

      expect(existsSync(requested)).toBe(false)
      expect(readFileSync(cached, "utf8")).toBe("x64")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
