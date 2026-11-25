import { describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileLogger } from "../src/observability/logging.js"
import { markRedacted, REDACTED } from "../src/redact.js"

const syntheticGithub = "gho_FAKEFAKE0000111122223333444455556666"
const syntheticNpm = "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"

describe("fileLogger redaction", () => {
  test("redacts secrets in messages, structured fields, causes, and annotations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-logging-redact-"))
    await using _ = {
      async [Symbol.asyncDispose]() {
        await fs.rm(dir, { recursive: true, force: true })
      },
    }
    const file = path.join(dir, "opencode.log")

    await Effect.logError(`failed with ${syntheticGithub}`, {
      url: "https://alice:s3cr3t@example.com/api",
      cause: new Error(`token=${syntheticNpm}`),
    }).pipe(
      Effect.annotateLogs({ note: `auth=${syntheticGithub}` }),
      Effect.provide(
        Logger.layer([fileLogger(file, "run-redact")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie),
      ),
      Effect.scoped,
      Effect.runPromise,
    )

    const line = (await Bun.file(file).text()).trim()
    expect(line).toContain(`message="failed with ${REDACTED}"`)
    expect(line).toContain(`url=https://${REDACTED}@example.com/api`)
    expect(line).toContain(`cause="Error: token=${REDACTED}"`)
    expect(line).toContain(`note="auth=${REDACTED}"`)
    expect(line).not.toContain(syntheticGithub)
    expect(line).not.toContain(syntheticNpm)
    expect(line).not.toContain("s3cr3t")
  })

  test("skips re-scanning values marked with markRedacted", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-logging-marked-"))
    await using _ = {
      async [Symbol.asyncDispose]() {
        await fs.rm(dir, { recursive: true, force: true })
      },
    }
    const file = path.join(dir, "opencode.log")
    const preRedacted = markRedacted([syntheticGithub])

    await Effect.logInfo("already redacted", {
      args: preRedacted,
      unmarked: [syntheticGithub],
    }).pipe(
      Effect.provide(
        Logger.layer([fileLogger(file, "run-marked")]).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie),
      ),
      Effect.scoped,
      Effect.runPromise,
    )

    const line = (await Bun.file(file).text()).trim()
    expect(line).toContain(`args=${JSON.stringify(JSON.stringify([syntheticGithub]))}`)
    expect(line).toContain(`unmarked=${JSON.stringify(JSON.stringify([REDACTED]))}`)
  })
})
