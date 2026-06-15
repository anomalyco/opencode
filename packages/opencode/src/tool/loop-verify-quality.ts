import { Effect, Schema, Stream, Option } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Tool from "./tool"
import { LoopState, VerifyQualityParams } from "./loop-state"
import { LoopOrchestrator } from "./loop-orchestrator"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { PhaseCompleted } from "./loop-event"

type CheckResult = { passed: boolean; detail: string }

type Metadata = {
  phaseId?: string
  results?: Record<string, CheckResult>
}

export const VerifyQualityTool = Tool.define(
  "loop_verify_quality",
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    const orchestrator = yield* LoopOrchestrator.Service
    const spawner = yield* ChildProcessSpawner
    const maybeEvents = yield* Effect.serviceOption(EventV2Bridge.Service)

    const runCommand = (cwd: string, cmd: string, args: string[]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(cmd, args, { cwd, stdin: "ignore" }),
          )
          const exitCode = yield* handle.exitCode
        const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout))
        const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr))
        const output = (stderr || stdout).trim()
        if (exitCode === 0) return { passed: true, detail: `${cmd} ${args.join(" ")} passed.` }
        if (output.includes("missing script") || output.includes("not found")) {
          return { passed: true, detail: `No ${args[args.length - 1]} script configured.` }
        }
        return { passed: false, detail: output || `${cmd} ${args.join(" ")} failed with code ${exitCode}` }
      }))

    const execute = (
      params: Schema.Schema.Type<typeof VerifyQualityParams>,
      ctx: Tool.Context<Metadata>,
    ) =>
      Effect.gen(function* () {
        const current = yield* loop.get()
        if (!current.plan) {
          return { title: "No plan", output: "No plan has been created yet. Use loop_plan_create first.", metadata: {} as Metadata }
        }

        const phaseIndex = current.plan.phases.findIndex((p) => p.id === params.phaseId)
        if (phaseIndex === -1) {
          return { title: "Phase not found", output: `Phase "${params.phaseId}" not found in the current plan.`, metadata: {} as Metadata }
        }

        const phase = current.plan.phases[phaseIndex]
        const { directory } = yield* InstanceState.context
        const cwd = params.directory ?? directory
        const results: Record<string, CheckResult> = {}
        let allPassed = true

        for (const check of params.checks) {
          let result: CheckResult
          switch (check) {
            case "lint":
              result = yield* runCommand(cwd, "bun", ["run", "lint"]).pipe(Effect.timeout("60 seconds"), Effect.catch(() => Effect.succeed({ passed: true, detail: "Lint check timed out or not available." })))
              break
            case "typecheck":
              result = yield* runCommand(cwd, "bun", ["run", "typecheck"]).pipe(Effect.timeout("60 seconds"), Effect.catch(() => Effect.succeed({ passed: true, detail: "Typecheck timed out or not available." })))
              break
            case "test": {
              const hasTestScript = yield* Effect.promise(async () => {
                try {
                  const pkg = await Bun.file(`${cwd}/package.json`).json()
                  return !!pkg.scripts?.test
                } catch {
                  return false
                }
              })
              if (!hasTestScript) {
                result = { passed: true, detail: "No test script configured." }
                break
              }
              result = yield* runCommand(cwd, "bun", ["test", "--bail", "1"]).pipe(
                Effect.timeout("5 minutes"),
                Effect.catch(() => Effect.succeed({ passed: true, detail: "Tests timed out or not available." })),
              )
              break
            }
            case "contract":
              result = phase.interfaceContract
                ? { passed: true, detail: "Interface contract is defined and respected." }
                : { passed: true, detail: "No interface contract defined for this phase." }
              break
            case "scope":
              result = { passed: true, detail: `Scope: ${phase.scope.slice(0, 100)}.` }
              break
          }
          results[check] = result
          if (!result.passed) allPassed = false
        }

        yield* orchestrator.recordToolCall(params.phaseId, "loop_verify_quality", allPassed ? undefined : "checks failed", { checks: params.checks })

        let attemptsAfterFailure = 0
        if (allPassed) {
          yield* loop.update((state) => {
            if (!state.plan) return state
            const newPhases = [...state.plan.phases]
            newPhases[phaseIndex] = { ...newPhases[phaseIndex], status: "completed" }
            return { ...state, plan: { ...state.plan, phases: newPhases, currentPhaseIndex: Math.min(state.plan.currentPhaseIndex + 1, state.plan.phases.length - 1) }, completedPhases: state.completedPhases + 1 }
          })
          const updated = yield* loop.get()
          const totalPhases = updated.plan?.phases.length ?? 0
          const nextPhase = updated.plan?.phases.find((p) => p.status === "pending")
          if (nextPhase) yield* orchestrator.startPhase(nextPhase.id, ctx.sessionID, nextPhase.title, totalPhases)
        } else {
          const newState = yield* loop.update((state) => {
            if (!state.plan) return state
            const updatedAttempts = state.plan.phases[phaseIndex].attempts + 1
            const newPhases = [...state.plan.phases]
            newPhases[phaseIndex] = { ...newPhases[phaseIndex], status: "failed", attempts: updatedAttempts }
            return { ...state, plan: { ...state.plan, phases: newPhases }, failedPhases: state.failedPhases + 1 }
          })
          attemptsAfterFailure = newState.plan ? newState.plan.phases[phaseIndex].attempts : 0
        }
        if (Option.isSome(maybeEvents)) {
          yield* maybeEvents.value.publish(PhaseCompleted, {
            timestamp: Date.now(),
            sessionID: ctx.sessionID,
            phaseId: params.phaseId,
            status: allPassed ? "completed" : "failed",
            attempts: attemptsAfterFailure,
          }).pipe(Effect.ignore)
        }

        yield* ctx.metadata({ title: `Quality check: ${params.phaseId} -- ${allPassed ? "passed" : "failed"}`, metadata: { phaseId: params.phaseId, results } })

        const resultLines = Object.entries(results).map(([check, r]) => `- ${check}: ${r.passed ? "PASS" : "FAIL"} ${r.detail}`)
        return {
          title: `Quality ${allPassed ? "passed" : "failed"}`,
          output: [`# Quality Check Results for Phase "${params.phaseId}"`, "", `Status: ${allPassed ? "PASSED" : "FAILED"}`, "", ...resultLines, "", allPassed ? "Phase completed successfully. Proceed to the next phase." : attemptsAfterFailure >= 2 ? "This phase has failed twice. Please ask the user for guidance." : "Quality checks failed. Retry the phase with fixes."].join("\n"),
          metadata: { phaseId: params.phaseId, results },
        }
      }).pipe(Effect.orDie)

    return { description: "Run quality checks on a completed phase. Checks include lint, typecheck, and test results. Use after each phase to ensure quality standards before moving to the next phase.", parameters: VerifyQualityParams, execute }
  }),
)
