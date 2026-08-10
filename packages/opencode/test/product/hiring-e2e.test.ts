// Subprocess E2E: moks-branded CLI entry → ta agent → fixture attaches → mock LLM.
// Uses TestLLMServer via cli-process (no live paid API).
import { expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"
import { HiringFixtures } from "../../src/product/fixtures"

const FIXTURE_SENTINEL = "Northline Analytics"

cliIt.concurrent(
  "moks run --agent ta with hiring fixtures exits 0 against mock LLM",
  ({ home, llm, opencode }) =>
    Effect.gen(function* () {
      const jd = path.join(home, "jd.md")
      const resume = path.join(home, "resume.md")
      const scorecard = path.join(home, "scorecard.md")
      yield* Effect.promise(async () => {
        await Bun.write(jd, await Bun.file(HiringFixtures.jd).text())
        await Bun.write(resume, await Bun.file(HiringFixtures.resume).text())
        await Bun.write(scorecard, await Bun.file(HiringFixtures.scorecard).text())
      })

      yield* llm.text("score: yes — strong postgres and event-driven signal")

      // `--` stops yargs from treating the prompt as another `--file` value.
      const result = yield* opencode.run("Score this candidate using the score-candidate skill", {
        agent: "ta",
        extraArgs: ["--file", jd, "--file", resume, "--file", scorecard, "--"],
        timeoutMs: 60_000,
      })

      opencode.expectExit(result, 0, "moks run --agent ta")
      expect(result.stdout).toContain("score: yes")
      expect(result.stderr).not.toContain('agent "ta" not found')

      const input = JSON.stringify(yield* llm.inputs)
      expect(input).toContain(FIXTURE_SENTINEL)
      expect(input).toContain("Jordan Lee")
    }),
  90_000,
)

cliIt.concurrent(
  "moks run defaults to ta agent when --agent omitted",
  ({ llm, opencode }) =>
    Effect.gen(function* () {
      yield* llm.text("default ta path ok")
      const result = yield* opencode.run("ping", { timeoutMs: 45_000 })
      opencode.expectExit(result, 0, "moks run default agent")
      expect(result.stdout).toContain("default ta path ok")
      expect(result.stderr).not.toContain("Falling back to default agent")
    }),
  60_000,
)

cliIt.live(
  "agent list includes native ta",
  ({ opencode }) =>
    Effect.gen(function* () {
      const r = yield* opencode.spawn(["agent", "list"])
      opencode.expectExit(r, 0, "agent list")
      expect(r.stdout.toLowerCase()).toContain("ta")
    }),
  60_000,
)
