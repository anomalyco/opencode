import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendFallbackDiagnostic } from "../src/fallback-log"
import { sanitize } from "../src/sanitize"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("gateway sanitization", () => {
  test("redacts configured values and credential-bearing keys recursively", () => {
    expect(
      sanitize(
        {
          message: "upstream returned secret-canary",
          nested: {
            authorization: "Bearer token-canary",
            Cookie: "session-cookie",
            api_key: "api-key",
            password: "database-password",
            reasoning: "hidden chain",
          },
          rows: [{ name: "6001ZZ", inventory: 200 }],
        },
        ["secret-canary", "token-canary"],
      ),
    ).toEqual({
      message: "upstream returned [REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        Cookie: "[REDACTED]",
        api_key: "[REDACTED]",
        password: "[REDACTED]",
        reasoning: "[REDACTED]",
      },
      rows: [{ name: "6001ZZ", inventory: 200 }],
    })
  })

  test("sanitizes errors without retaining stack or secret text", () => {
    expect(sanitize(new Error("Bearer secret-canary failed"), ["secret-canary"])).toEqual({
      name: "Error",
      message: "Bearer [REDACTED] failed",
    })
  })

  test("writes one sanitized JSONL fallback diagnostic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "feishu-fallback-"))
    directories.push(directory)
    const path = join(directory, "nested", "fallback.jsonl")

    await appendFallbackDiagnostic(
      path,
      { stage: "receipt", error: "secret-canary", token: "token-canary", traceID: "trace_1" },
      ["secret-canary"],
    )

    const lines = (await Bun.file(path).text()).trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      stage: "receipt",
      error: "[REDACTED]",
      token: "[REDACTED]",
      traceID: "trace_1",
    })
  })
})
