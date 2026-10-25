// CLI entry point for `bolt eval`: the agent evaluation benchmark harness.
//
// Each eval case is a markdown file (frontmatter + prompt body, see
// ./eval/case.ts). The harness runs every case against an in-process server in
// its own isolated temp workspace, waits for the session to finish, grades the
// workspace with the case's checks, and reports pass/fail plus cost and token
// usage. Exit code is 1 when any case fails, 5 when any case timed out.
import type { Argv } from "yargs"
import path from "path"
import os from "os"
import { mkdtemp, rm } from "node:fs/promises"
import { Effect } from "effect"
import { createBoltClient, type OpencodeClient } from "@bolt-ai/sdk/v2"
import { UI } from "../ui"
import { ExitCode } from "../exit"
import { effectCmd, fail } from "../effect-cmd"
import type { CheckResult, Info } from "./eval/case"

type ModelInput = Parameters<OpencodeClient["session"]["prompt"]>[0]["model"]

function pick(value: string | undefined): ModelInput | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  } as ModelInput
}

interface CaseResult {
  item: Info
  file: string
  workspace: string
  sessionID?: string
  passed: boolean
  checks: CheckResult[]
  errors: string[]
  timedOut?: boolean
  durationMs: number
  cost?: number
  tokens?: unknown
}

export const EvalCommand = effectCmd({
  command: "eval [paths..]",
  describe: "run agent evaluation cases and grade the results",
  // Each case loads its own instance for its temp workspace through the
  // server's per-directory routing; no instance is needed for the cwd.
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("paths", {
        describe: "eval case files or directories (default: ./evals)",
        type: "string",
        array: true,
        default: ["evals"],
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "default model in provider/model format (cases can override)",
      })
      .option("agent", {
        type: "string",
        describe: "default agent (cases can override)",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (one JSON object per line)",
      })
      .option("timeout", {
        type: "number",
        default: 300,
        describe: "per-case timeout in seconds (cases can override)",
      })
      .option("keep", {
        type: "boolean",
        default: false,
        describe: "keep case workspaces on disk for debugging",
      })
      .epilogue(
        `exit codes: ${ExitCode.OK} all passed, ${ExitCode.ERROR} a case failed, ${ExitCode.TIMEOUT} a case timed out`,
      ),
  handler: Effect.fn("Cli.eval")(function* (args) {
    // Loaded lazily so the CLI entrypoint does not pull the eval/session graph
    // at startup for unrelated commands.
    const { discover, load, runCheck, describeCheck } = yield* Effect.promise(() => import("./eval/case"))
    const discovered = yield* Effect.promise(() => discover(args.paths))
    if (discovered.missing.length) {
      return yield* fail(`No such file or directory: ${discovered.missing.join(", ")}`)
    }
    if (discovered.files.length === 0) {
      return yield* fail(`No eval cases found in: ${args.paths.join(", ")}`)
    }
    const cases = yield* Effect.promise(() => Promise.all(discovered.files.map((file) => load(file))))

    yield* Effect.promise(async () => {
      const json = args.format === "json"
      const { ServerLocalFetch } = await import("@/server/local-fetch")
      const fetchFn = ServerLocalFetch.fetchFn

      function emit(type: string, data: Record<string, unknown>) {
        if (!json) return
        process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), ...data }) + os.EOL)
      }

      async function execute(item: Info, file: string): Promise<CaseResult> {
        const start = Date.now()
        const workspace = await mkdtemp(path.join(os.tmpdir(), "bolt-eval-"))
        const errors: string[] = []
        const failure = (message: string): CaseResult => ({
          item,
          file,
          workspace,
          passed: false,
          checks: [],
          errors: [...errors, message],
          durationMs: Date.now() - start,
        })

        for (const [relative, content] of Object.entries(item.files ?? {})) {
          await Bun.write(path.join(workspace, relative), content)
        }

        const sdk = createBoltClient({
          baseUrl: "http://bolt.internal",
          fetch: fetchFn,
          directory: workspace,
        })
        const session = await sdk.session.create({
          title: `eval: ${item.name}`,
          permission: [
            { permission: "question", pattern: "*", action: "deny" },
            { permission: "plan_enter", pattern: "*", action: "deny" },
            { permission: "plan_exit", pattern: "*", action: "deny" },
          ],
        })
        const sessionID = session.data?.id
        if (!sessionID) return failure("failed to create session")

        // The workspace is an isolated throwaway temp directory, so tool
        // permissions are auto-approved; question/plan permissions stay
        // denied via the session ruleset above.
        const events = await sdk.event.subscribe()
        const pump = (async () => {
          for await (const event of events.stream) {
            if (event.type === "permission.asked") {
              const permission = event.properties
              if (permission.sessionID !== sessionID) continue
              await sdk.permission.reply({ requestID: permission.id, reply: "once" })
            }
            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID || !props.error) continue
              const err =
                "data" in props.error && props.error.data && "message" in props.error.data
                  ? String(props.error.data.message)
                  : String(props.error.name)
              errors.push(err)
            }
            if (
              event.type === "session.status" &&
              event.properties.sessionID === sessionID &&
              event.properties.status.type === "idle"
            ) {
              break
            }
          }
        })().catch(() => {})

        let timedOut = false
        const timeoutMs = (item.timeout ?? args.timeout) * 1000
        const timer = setTimeout(() => {
          timedOut = true
          void sdk.session.abort({ sessionID }).catch(() => {})
        }, timeoutMs)
        const result = await sdk.session
          .prompt({
            sessionID,
            model: pick(item.model ?? args.model),
            agent: item.agent ?? args.agent,
            parts: [{ type: "text", text: item.prompt }],
          })
          .finally(() => clearTimeout(timer))
        if (result.error) {
          errors.push(JSON.stringify(result.error))
        } else {
          await pump
        }
        if (timedOut) errors.push(`timed out after ${timeoutMs / 1000}s`)

        const checks: CheckResult[] = []
        for (const check of item.expect) {
          checks.push(await runCheck(check, workspace))
        }
        const info = await sdk.session
          .get({ sessionID })
          .then((response) => response.data)
          .catch(() => undefined)
        return {
          item,
          file,
          workspace,
          sessionID,
          passed: errors.length === 0 && checks.every((check) => check.passed),
          checks,
          errors,
          timedOut,
          durationMs: Date.now() - start,
          cost: info?.cost,
          tokens: info?.tokens,
        }
      }

      function report(result: CaseResult) {
        emit("eval_case", {
          name: result.item.name,
          file: result.file,
          sessionID: result.sessionID,
          passed: result.passed,
          checks: result.checks.map((entry) => ({
            ...entry.check,
            passed: entry.passed,
            detail: entry.detail,
          })),
          errors: result.errors,
          durationMs: result.durationMs,
          cost: result.cost,
          tokens: result.tokens,
          workspace: args.keep ? result.workspace : undefined,
        })
        if (json) return
        const seconds = `${(result.durationMs / 1000).toFixed(1)}s`
        const cost = result.cost ? ` · $${result.cost.toFixed(4)}` : ""
        const marker = result.passed ? UI.Style.TEXT_SUCCESS + "✓" : UI.Style.TEXT_DANGER_BOLD + "✗"
        UI.println(
          `${marker} ${UI.Style.TEXT_NORMAL}${result.item.name} ${UI.Style.TEXT_DIM}${seconds}${cost}${UI.Style.TEXT_NORMAL}`,
        )
        result.checks
          .filter((entry) => !entry.passed)
          .forEach((entry) =>
            UI.println(
              `  ${UI.Style.TEXT_DANGER_BOLD}✗${UI.Style.TEXT_NORMAL} ${describeCheck(entry.check)}${UI.Style.TEXT_DIM}${entry.detail ? ` — ${entry.detail}` : ""}${UI.Style.TEXT_NORMAL}`,
            ),
          )
        result.errors.forEach((error) => UI.println(`  ${UI.Style.TEXT_DANGER_BOLD}!${UI.Style.TEXT_NORMAL} ${error}`))
        if (args.keep) UI.println(`  ${UI.Style.TEXT_DIM}workspace: ${result.workspace}${UI.Style.TEXT_NORMAL}`)
      }

      const results: CaseResult[] = []
      for (const [index, item] of cases.entries()) {
        if (!json) {
          const model = item.model ?? args.model
          UI.println(`${UI.Style.TEXT_DIM}● ${item.name} running${model ? ` on ${model}` : ""}…${UI.Style.TEXT_NORMAL}`)
        }
        const result = await execute(item, discovered.files[index])
        if (!args.keep) await rm(result.workspace, { recursive: true, force: true }).catch(() => {})
        report(result)
        results.push(result)
      }

      const passed = results.filter((result) => result.passed).length
      const cost = results.reduce((sum, result) => sum + (result.cost ?? 0), 0)
      const durationMs = results.reduce((sum, result) => sum + result.durationMs, 0)
      emit("eval_summary", { total: results.length, passed, failed: results.length - passed, durationMs, cost })
      if (!json) {
        UI.empty()
        const style = passed === results.length ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_DANGER_BOLD
        UI.println(
          `${style}${passed}/${results.length} passed${UI.Style.TEXT_NORMAL} ${UI.Style.TEXT_DIM}${(durationMs / 1000).toFixed(1)}s${cost ? ` · $${cost.toFixed(4)}` : ""}${UI.Style.TEXT_NORMAL}`,
        )
      }
      if (passed !== results.length) {
        process.exitCode = results.some((result) => result.timedOut) ? ExitCode.TIMEOUT : ExitCode.ERROR
      }
    })
  }),
})
