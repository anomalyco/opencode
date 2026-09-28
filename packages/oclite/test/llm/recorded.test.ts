// Phase 7 (ARCHITECTURE §14): one hosted Anthropic turn through the real app layer, with @opencode-ai/http-recorder
// supplied as appLayer's `http` parameter.
//   - cassette present          → replay it (no network)
//   - no cassette, key present  → record it from the real API (review the JSON before committing it)
//   - neither                   → skipped (Deviation: no cassette is committed and no key is available)
// Refresh: delete test/fixtures/recordings/anthropic/one-turn.json and run with ANTHROPIC_API_KEY set.
import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { HttpRecorder } from "@opencode-ai/http-recorder"
import type { CliArgs } from "../../src/cli/args"
import { load } from "../../src/config/config"
import { Runtime } from "../../src/contract"
import { headlessAsker } from "../../src/permission/permission"
import { appLayer } from "../../src/runtime/runtime"
import { tmpdir } from "../lib/tmp"

const directory = path.resolve(import.meta.dir, "../fixtures/recordings")
const NAME = "anthropic/one-turn"
const cassette = existsSync(path.join(directory, `${NAME}.json`))
const key = process.env.ANTHROPIC_API_KEY
const mode = cassette ? "replay" : key ? "record" : "skip"

const args: CliArgs = {
  outputFormat: "text",
  mcpConfig: [],
  strictMcpConfig: false,
  allowedTools: [],
  disallowedTools: [],
  continue: false,
  noThinking: false,
}

describe("recorded hosted turn (http-recorder)", () => {
  const run = mode === "skip" ? test.skip : test
  if (mode === "skip")
    console.log(`recorded.test: skipped — no cassette at ${path.join(directory, `${NAME}.json`)} and ANTHROPIC_API_KEY is unset`)

  run(`anthropic one turn (${mode})`, async () => {
    await using project = await tmpdir({ git: true })
    await using home = await tmpdir()
    await using data = await tmpdir()
    const previous = { data: process.env.XDG_DATA_HOME, trust: process.env.OCLITE_TRUST_PROJECT }
    process.env.XDG_DATA_HOME = data.path
    // The project config sets a provider, which only a trusted project layer may do (SECURITY F1).
    process.env.OCLITE_TRUST_PROJECT = "1"
    await project.write(
      ".oclite/config.json",
      JSON.stringify({
        model: "anthropic/claude-sonnet-5",
        // Replay needs no real key: the recorder redacts it and matches on method + path only.
        provider: { anthropic: { options: { apiKey: key ?? "sk-ant-replay" } } },
      }),
    )
    const cfg = await Effect.runPromise(
      load(args, { cwd: project.path, home: home.path, configDir: path.join(home.path, ".config", "oclite") }),
    )
    // The request body carries today's date and the temp cwd, so match on method and path, in order.
    const http = HttpRecorder.http(NAME, {
      directory,
      match: (incoming, recorded) =>
        incoming.method === recorded.method && new URL(incoming.url).pathname === new URL(recorded.url).pathname,
    })
    const program = Effect.gen(function* () {
      const runtime = yield* Runtime
      const handle = yield* runtime.start({ agent: "build", prompt: "Reply with exactly the word: pong", maxTurns: 1 }, () => Effect.void)
      return yield* handle.await
    })
    const result = await Effect.runPromise(program.pipe(Effect.provide(appLayer(cfg, headlessAsker, http, { retryDelays: [] }))))
    restore("XDG_DATA_HOME", previous.data)
    restore("OCLITE_TRUST_PROJECT", previous.trust)
    expect(result).toMatchObject({ state: "completed", reason: "stop" })
    expect(result.text.toLowerCase()).toContain("pong")
    expect(result.usage.input).toBeGreaterThan(0)
  }, 60_000)
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) return void delete process.env[name]
  process.env[name] = value
}
