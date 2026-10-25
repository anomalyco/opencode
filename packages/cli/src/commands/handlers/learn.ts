import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

type Part = {
  type: string
  tool?: string
  state?: { status: string; metadata?: Record<string, unknown> }
}

/** Count completed memory_save calls in a finished run and collect the memory files they touched. */
export function saved(parts: Part[]) {
  const done = parts.filter(
    (part) => part.type === "tool" && part.tool === "memory_save" && part.state?.status === "completed",
  )
  const sources = [
    ...new Set(
      done.flatMap((part) => {
        const value = part.state?.metadata?.sources
        if (!Array.isArray(value)) return []
        return value.filter((item): item is string => typeof item === "string")
      }),
    ),
  ]
  return { count: done.length, sources }
}

const INSTRUCTIONS = [
  "Analyze this repository's conventions using your read, grep, glob, and bash tools. Cover:",
  "- naming (files, variables, functions, exports)",
  "- formatting and code style",
  "- error handling patterns",
  "- test patterns (framework, file layout, assertion style)",
  "- commit style (inspect recent subjects with `git log --format=%s -30`)",
  "- directory layout and module organization",
  "Ground every finding in files you actually read; skip areas the repository has no evidence for.",
  'Persist each durable convention with the memory_save tool: action "remember", one concise self-contained entry per convention, phrased as a rule future sessions can follow.',
  "Do not save one-off observations, secrets, or anything specific to uncommitted work.",
  "End with a short markdown summary of the conventions you saved, grouped by area.",
].join("\n")

export const LearnCommand = effectCmd({
  command: "learn",
  describe: "learn this repository's conventions into project memory",
  builder: (yargs) =>
    yargs.option("model", {
      alias: "m",
      type: "string",
      describe: "model to use in the format of provider/model",
    }),
  handler: Effect.fn("Cli.learn")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const { MemoryService } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/service"))
    const { MemoryPaths } = yield* Effect.promise(() => import("@bolt-ai/memory/effect/paths"))
    const memory = MemoryService.make()
    const status = yield* memory.status({ ctx }).pipe(Effect.orDie)
    // memory_save is a no-op against a disabled store, so a learn run must enable it first.
    if (!status.state.enabled) yield* memory.enable({ ctx }).pipe(Effect.orDie)

    // Deterministic pass first: build/test commands come straight from the repo's manifests,
    // no model required, so they land even if the LLM pass saves nothing new about them.
    const { MemoryToolchain } = yield* Effect.promise(() => import("@bolt-ai/memory/toolchain"))
    const detected = yield* Effect.promise(() =>
      MemoryToolchain.learn({ root: MemoryPaths.root({ ctx }), worktree: ctx.worktree }),
    )
    if (detected.entries.length > 0) {
      UI.println(
        `Auto-learned ${detected.entries.length} toolchain command${detected.entries.length === 1 ? "" : "s"}: ${detected.entries
          .map((item) => item.command)
          .join(", ")}`,
      )
    }

    UI.println("Learning repository conventions...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt learn",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "build",
        model: args.model ? parseModel(args.model) : undefined,
        parts: [{ id: PartID.ascending(), type: "text", text: INSTRUCTIONS }],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const text = extractResponseText(result.parts) ?? ""
    if (text) {
      UI.empty()
      UI.println(UI.markdown(text))
    }

    const writes = saved(result.parts)
    if (writes.count === 0 && detected.applied === 0) {
      return yield* fail("The run finished without saving any conventions to project memory.")
    }
    if (writes.count === 0) {
      UI.empty()
      UI.println(
        `The model pass saved nothing new, but ${detected.applied} auto-learned command${detected.applied === 1 ? "" : "s"} persisted to project memory at ${MemoryPaths.root({ ctx })}`,
      )
      return
    }
    UI.empty()
    UI.println(
      `Saved ${writes.count} convention ${writes.count === 1 ? "entry" : "entries"}${
        writes.sources.length ? ` (${writes.sources.join(", ")})` : ""
      } to project memory at ${MemoryPaths.root({ ctx })}`,
    )
    UI.println("New sessions in this project will start with these conventions via memory recall.")
  }),
})
