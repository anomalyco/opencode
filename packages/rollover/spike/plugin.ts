/**
 * Rollover Phase 0 spike plugin (spec Part A §2.2, Part B §2).
 * Logs hook invocations as JSONL to $SPIKE_LOG and dumps message-shape
 * fixtures to $SPIKE_FIXTURES. Applies an optional P0-2 mutation.
 *
 * Loaded from the sandbox test project only — never the user's environment.
 */
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const logPath = process.env.SPIKE_LOG ?? "/tmp/rollover-spike/log.jsonl"
const fixtureDir = process.env.SPIKE_FIXTURES ?? "/tmp/rollover-spike"
const mutation = process.env.SPIKE_MUTATE ?? ""
let contextCalls = 0

type Json = Record<string, unknown>

const append = (entry: Json) =>
  Effect.sync(() => {
    mkdirSync(path.dirname(logPath), { recursive: true })
    appendFileSync(logPath, JSON.stringify({ ts: Date.now(), ...entry }) + "\n")
  })

interface SpikeMessage {
  id?: string
  role: string
  content?: Array<{ type: string; text?: string; id?: string; name?: string }>
}

const summarize = (messages: readonly SpikeMessage[]) =>
  messages.map((m, index) => ({
    index,
    id: m.id ?? null,
    role: m.role,
    partTypes: (m.content ?? []).map((part) => part.type),
    firstText: (m.content ?? []).find((part) => part.type === "text")?.text?.slice(0, 80) ?? null,
  }))

const dumpFixture = (name: string, data: Json) =>
  Effect.sync(() => {
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(path.join(fixtureDir, name), JSON.stringify(data, null, 2))
  })

const truncateParts = (messages: readonly SpikeMessage[]) =>
  messages.map((m) => ({
    ...m,
    content: (m.content ?? []).map((part) =>
      part.type === "text" && part.text && part.text.length > 400 ? { ...part, text: part.text.slice(0, 400) + "…[cut]" } : part,
    ),
  }))

export default define({
  id: "rollover.spike",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* append({ hook: "plugin-load", pid: process.pid })

      // P0-1 / P0-2 / P0-3 / P0-4: the model-facing message hook.
      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          contextCalls += 1
          const messages = event.messages as unknown as SpikeMessage[]
          yield* append({
            hook: "context",
            call: contextCalls,
            sessionID: event.sessionID,
            model: event.model,
            agent: event.agent,
            msgsLen: messages.length,
            roles: messages.map((m) => m.role),
            lastRole: messages.at(-1)?.role ?? null,
            ids: messages.map((m) => m.id ?? null),
            summarize: summarize(messages),
          })
          if (contextCalls <= 6) {
            yield* dumpFixture(`context-${contextCalls}.json`, {
              sessionID: event.sessionID,
              model: event.model,
              count: messages.length,
              messages: truncateParts(messages),
            })
          }
          if (mutation === "delete-first" && messages.length > 1) {
            messages.splice(0, 1)
            yield* append({ hook: "mutate", kind: "delete-first", newLen: messages.length })
          }
          if (mutation === "replace-last-text") {
            const last = messages.at(-1)
            const textPart = last?.content?.find((part) => part.type === "text")
            if (textPart) {
              textPart.text = "SPIKE_REPLACED_TEXT"
              yield* append({ hook: "mutate", kind: "replace-last-text" })
            }
          }
        }),
      )

      // P0-6: idle hook with background work listing.
      yield* ctx.session.hook("experimental.idle", (event) =>
        append({ hook: "idle", sessionID: event.sessionID, background: event.background }),
      )

      // P0-12: tool names and inputs.
      yield* ctx.tool.hook("execute.before", (event) =>
        append({
          hook: "tool.before",
          sessionID: event.sessionID,
          tool: event.tool,
          messageID: event.messageID,
          callID: event.id,
          input: typeof event.input === "object" ? event.input : String(event.input).slice(0, 200),
        }),
      )
      yield* ctx.tool.hook("execute.after", (event) =>
        append({
          hook: "tool.after",
          sessionID: event.sessionID,
          tool: event.tool,
          status: event.status,
          callID: event.id,
        }),
      )

      // P0-5 / P0-11: usage + lifecycle bus events. Subscribe to everything, log a
      // name-based subset so the full event vocabulary is visible in the log.
      yield* ctx.event
        .subscribe()
        .pipe(
          Stream.runForEach((event: any) =>
            append({
              hook: "event",
              type: event?.type ?? "unknown",
              // Full payload for session.* events (usage semantics, P0-5/P0-11);
              // type-only for the rest to keep the log bounded.
              payload:
                typeof event?.type === "string" && event.type.startsWith("session.")
                  ? JSON.stringify(event).slice(0, 1200)
                  : undefined,
            }),
          ),
          Effect.forkScoped,
        )

      // P0-8 / P0-9: a probe command executed directly (no model round-trip).
      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "p0",
          description: "Rollover spike probe",
          execute: (input) =>
            Effect.scoped(
            Effect.gen(function* () {
              const before = (yield* ctx.session.list()).data.length
              const [providerID, modelID] = (process.env.SPIKE_MODEL ?? "").split("/")
              const generated = yield* ctx.experimental.generate.text({
                prompt: "Reply with exactly one word and nothing else: SPIKE_OK",
                ...(providerID && modelID ? { model: { providerID, id: modelID } as never } : {}),
              })
              const after = (yield* ctx.session.list()).data.length
              let modelLimit: unknown = null
              yield* ctx.model.transform((editor) => {
                const info = editor.get("mockllm", "test-model") as unknown as Json | undefined
                modelLimit = info ? (info.limit ?? "no-limit-field") : "not-found"
              })
              yield* append({
                hook: "command",
                name: "p0",
                sessionID: input.sessionID,
                promptText: input.prompt.text.slice(0, 200),
                generateText: typeof generated === "string" ? generated : JSON.stringify(generated).slice(0, 300),
                sessionsBefore: before,
                sessionsAfter: after,
                modelLimit,
              })
            }),
            ),
        })
      })

      yield* append({ hook: "plugin-ready" })
    }),
})
