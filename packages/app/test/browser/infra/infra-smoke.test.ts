import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "vitest"
import { startE2eDockerDeps } from "../../../script/e2e-testcontainers"

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")

describe("e2e docker infra smoke", () => {
  test("start deps then stop (no app stack)", async () => {
    const deps = await startE2eDockerDeps(repoDir, { reuse: false })
    await deps.stop()
  }, 300_000)
})
