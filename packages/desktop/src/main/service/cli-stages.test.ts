import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"

import { testEffect } from "../../../../core/test/lib/effect"
import { cleanStages } from "./cli-stages"
import { stageName, stageRetention } from "./cli-version"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))

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

  ;[
    { name: "same-version channel switch", running: "2.0.32" },
    { name: "older adopted server", running: "2.0.31" },
  ].forEach((input) => {
    it.live(
      `preserves running CLI candidates after ${input.name}`,
      Effect.gen(function* () {
        const root = mkdtempSync(path.join(tmpdir(), "opencode-cli-stages-"))
        const stages = {
          current: stageName("2.0.32", "next"),
          adopted: stageName(input.running, "dev"),
          legacy: `${input.running}-${process.arch}`,
          stale: stageName(`${input.running}0`, "dev"),
          foreign: stageName(input.running, "dev", process.arch === "arm64" ? "x64" : "arm64"),
        }

        try {
          Object.values(stages).forEach((stage) => {
            mkdirSync(path.join(root, stage))
            writeFileSync(path.join(root, stage, "opencode-cli"), stage)
          })
          writeFileSync(path.join(root, "unrelated"), "")

          yield* cleanStages(path.join(root, stages.current, "opencode-cli"), stageRetention(input.running))

          expect(readdirSync(root).sort()).toEqual(
            [stages.current, stages.adopted, stages.legacy, "unrelated"].sort(),
          )
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }),
    )
  })
})
