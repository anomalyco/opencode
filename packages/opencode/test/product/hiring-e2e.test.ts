// Subprocess E2E: moks-branded CLI entry → recruit agent → fixture attaches → mock LLM.
// Uses TestLLMServer via cli-process (no live paid API).
import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"
import { HiringFixtures } from "../../src/product/fixtures"

const FIXTURE_SENTINEL = "Northline Analytics"

cliIt.concurrent(
  "moks run --agent recruit with hiring fixtures exits 0 against mock LLM",
  ({ home, llm, opencode }) =>
    Effect.gen(function* () {
      const hiring = path.join(home, "HIRING.md")
      const card = path.join(home, "candidates", "jordan-lee.md")
      yield* Effect.promise(async () => {
        await Bun.write(hiring, await Bun.file(HiringFixtures.hiring).text())
        await Bun.write(card, await Bun.file(HiringFixtures.card).text())
      })

      yield* llm.text("score: yes — strong postgres and event-driven signal")

      // `--` stops yargs from treating the prompt as another `--file` value.
      const result = yield* opencode.run("Score this candidate using the score-candidate skill", {
        agent: "recruit",
        extraArgs: ["--file", hiring, "--file", card, "--"],
        timeoutMs: 60_000,
      })

      opencode.expectExit(result, 0, "moks run --agent recruit")
      expect(result.stdout).toContain("score: yes")
      expect(result.stderr).not.toContain('agent "recruit" not found')

      const input = JSON.stringify(yield* llm.inputs)
      expect(input).toContain(FIXTURE_SENTINEL)
      expect(input).toContain("Jordan Lee")
    }),
  90_000,
)

cliIt.concurrent(
  "moks run defaults to recruit agent when --agent omitted",
  ({ llm, opencode }) =>
    Effect.gen(function* () {
      yield* llm.text("default recruit path ok")
      const result = yield* opencode.run("ping", { timeoutMs: 45_000 })
      opencode.expectExit(result, 0, "moks run default agent")
      expect(result.stdout).toContain("default recruit path ok")
      expect(result.stderr).not.toContain("Falling back to default agent")
    }),
  60_000,
)

cliIt.live(
  "agent list includes native recruit",
  ({ opencode }) =>
    Effect.gen(function* () {
      const r = yield* opencode.spawn(["agent", "list"])
      opencode.expectExit(r, 0, "agent list")
      expect(r.stdout.toLowerCase()).toContain("recruit")
    }),
  60_000,
)
