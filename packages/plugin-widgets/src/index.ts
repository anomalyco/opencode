/// <reference path="./markdown.d.ts" />

import { Plugin } from "@opencode/plugin/effect"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Skill } from "@opencode/schema/skill"
import { Tool } from "@opencode/schema/tool"
import { Widget } from "@opencode/schema/widget"
import { Clock, Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import skill from "./skill.md" with { type: "text" }
import { WidgetTemplates } from "./widget-templates.js"
import { WidgetTools } from "./tools.js"

export { WidgetTemplates } from "./widget-templates.js"
export { WidgetTools } from "./tools.js"

export const id = "opencode.widget"

/** At most one error report per widget is delivered within this many milliseconds. */
export const REPORT_WINDOW_MS = 10_000

/** Why a waiting tool call ends without an answer: a client's runtime error, or a newer widget replaced it. */
class WaitFailure {
  constructor(readonly text: string) {}
}

/** At most this many `send` messages per widget within {@link RATE_WINDOW_MS}. */
export const RATE_LIMIT = 10
export const RATE_WINDOW_MS = 1000

type Call = { readonly sessionID: string; readonly messageID: string; readonly callID: string }

// Process-wide rather than per activation, so a plugin reload or another Location's instance still finds a waiting
// call. Keys are a widget's storage key.
const waiters = new Map<string, Deferred.Deferred<Widget.Response, WaitFailure>>()
// Error reports already delivered per widget (`phase\0message`), and when the last one went out.
const reports = new Map<string, { readonly seen: Set<string>; last: number }>()
const recentSends = new Map<string, number[]>()
// Serializes every state change and its delivery, so a widget is answered once, never sends after its answer, and its
// messages reach the model in order. Process-local: one server process per database.
const lock = Semaphore.makeUnsafe(1)

const stateKey = (call: Call) => `state:${call.sessionID}:${call.messageID}:${call.callID}`
const decodeState = Schema.decodeUnknownOption(Widget.State)
const encodeState = Schema.encodeSync(Widget.State)

const label = (state: Pick<Widget.State, "title" | "widgetTemplate">) => state.title ?? state.widgetTemplate.name

export const responseText = (state: Pick<Widget.State, "title" | "widgetTemplate">, response: Widget.Response) =>
  "value" in response
    ? `User responded to widget "${label(state)}": ${JSON.stringify(response.value)}`
    : `User dismissed widget "${label(state)}"`

export const errorText = (
  state: Pick<Widget.State, "title" | "widgetTemplate">,
  error: Widget.RuntimeError,
  client: string,
) => {
  const position =
    error.line === undefined ? "" : ` (line ${error.line}${error.column === undefined ? "" : `, col ${error.column}`})`
  return `Widget "${label(state)}" failed on ${client}: ${error.phase}: ${error.message}${position}`
}

export const messageText = (state: Pick<Widget.State, "title" | "widgetTemplate">, value: unknown) =>
  `Widget "${label(state)}" sent: ${JSON.stringify(value)}`

const messageDescription = (state: Pick<Widget.State, "title" | "widgetTemplate">, value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return `${label(state)}: ${text.length > 80 ? text.slice(0, 79) + "…" : text}`
}

export default Plugin.define({
  id,
  effect: (ctx) =>
    Effect.gen(function* () {
      const widgetTemplates = WidgetTemplates.make(ctx.storage)
      const holder: { rpc?: RpcRegistration<typeof Widget.Definition> } = {}

      const read = Effect.fnUntraced(function* (call: Call) {
        return Option.getOrUndefined(decodeState(yield* ctx.storage.get(stateKey(call))))
      })

      // Clients read states through `states` and follow `changed`, so every write publishes the new value.
      const write = Effect.fnUntraced(function* (state: Widget.State) {
        yield* ctx.storage.set(stateKey(state), encodeState(state))
        yield* (holder.rpc?.events.emit("changed", { sessionID: state.sessionID, state }) ?? Effect.void).pipe(
          Effect.catchCause((cause) => Effect.logWarning("failed to publish a widget change", { cause })),
        )
      })

      // Every state under `prefix`: one Session's (`state:<sessionID>:`) or the server's (`state:`).
      const scan = Effect.fnUntraced(function* (prefix: string) {
        const states: Widget.State[] = []
        let after: string | undefined
        do {
          const page = yield* ctx.storage.scan({ prefix, after, limit: 100 })
          for (const entry of page.entries) {
            const state = Option.getOrUndefined(decodeState(entry.value))
            if (state) states.push(state)
          }
          after = page.next
        } while (after !== undefined)
        return states
      })

      const list = Effect.fn("WidgetPlugin.list")(function* (sessionID: string) {
        return (yield* scan(`state:${sessionID}:`)).toSorted((a, b) => a.time.created - b.time.created)
      })

      // The data lives only in the tool call's input, so each widget's message is read (once per message). A widget
      // whose Session is gone is left out; states of a deleted Session are removed anyway.
      // A superseded widget is listed under the one that replaced it, so a client holding its key follows the update.
      const instances = Effect.fn("WidgetPlugin.instances")(function* () {
        const sessions = new Map<string, Option.Option<Session.Info>>()
        const messages = new Map<string, Option.Option<SessionMessage.Info>>()
        const found: Widget.Instance[] = []
        const states = yield* scan("state:")
        const byKey = new Map(states.map((state) => [stateKey(state), state]))
        const replaced = new Map<string, Array<{ messageID: string; callID: string }>>()
        for (const old of states) {
          let current = old
          for (let hops = 0; current.supersededBy && hops < states.length; hops++) {
            const next = byKey.get(stateKey({ sessionID: current.sessionID, ...current.supersededBy }))
            if (!next) break
            current = next
          }
          if (current === old || current.status === "superseded") continue
          const key = stateKey(current)
          replaced.set(key, [...(replaced.get(key) ?? []), { messageID: old.messageID, callID: old.callID }])
        }
        for (const state of states) {
          if (state.status === "superseded") continue
          const sessionID = Session.ID.make(state.sessionID)
          const session = sessions.get(state.sessionID) ?? (yield* ctx.session.get({ sessionID }).pipe(Effect.option))
          sessions.set(state.sessionID, session)
          if (Option.isNone(session)) continue
          const message =
            messages.get(state.messageID) ??
            (yield* ctx.session.message
              .get({ sessionID, messageID: SessionMessage.ID.make(state.messageID) })
              .pipe(Effect.option))
          messages.set(state.messageID, message)
          const info = Option.getOrUndefined(message)
          const part =
            info?.type === "assistant"
              ? info.content.find((part) => part.type === "tool" && part.id === state.callID)
              : undefined
          const data = part?.type === "tool" && part.state.status !== "streaming" ? part.state.input.data : undefined
          found.push({
            state,
            ...(data === undefined ? {} : { data: data as Schema.Json }),
            session: {
              ...(session.value.title === undefined ? {} : { title: session.value.title }),
              location: session.value.location,
            },
            updated: state.time.responded ?? state.time.created,
            ...(replaced.has(stateKey(state)) ? { replaced: replaced.get(stateKey(state)) } : {}),
          })
        }
        return found.toSorted((a, b) => b.updated - a.updated)
      })

      // Admitted as a steered synthetic message, so it reaches the model like a prompt: an idle Session wakes into a
      // turn, a busy one takes it at its next step. `resume: false` admits it without waking.
      const deliver = (
        state: Widget.State,
        kind: "response" | "message" | "error",
        text: string,
        description: string,
        wake: boolean,
      ) =>
        ctx.session
          .synthetic({
            sessionID: Session.ID.make(state.sessionID),
            text,
            description,
            metadata: { widget: { messageID: state.messageID, callID: state.callID, kind } },
            resume: wake,
          })
          .pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to deliver a widget answer", { sessionID: state.sessionID, cause }),
            ),
          )

      type Outcome =
        | { readonly type: "not_found" }
        | { readonly type: "closed"; readonly status: Exclude<Widget.Status, "open"> }
        | { readonly type: "ok"; readonly state: Widget.State }

      const respond = Effect.fn("WidgetPlugin.respond")(function* (call: Call, response: Widget.Response) {
        return yield* Effect.gen(function* () {
          const state = yield* read(call)
          if (!state) return { type: "not_found" } as Outcome
          if (state.status !== "open") return { type: "closed", status: state.status } as Outcome
          const next: Widget.State = {
            ...state,
            status: "value" in response ? "submitted" : "dismissed",
            ...("value" in response ? { response: response.value } : {}),
            time: { ...state.time, responded: yield* Clock.currentTimeMillis },
          }
          // Not atomic: the state is written before the answer is delivered. If the process dies in between, the
          // widget shows as answered and the model never hears of it; the user can say so in the prompt.
          yield* write(next)
          const waiter = waiters.get(stateKey(call))
          if (waiter) {
            waiters.delete(stateKey(call))
            yield* Deferred.succeed(waiter, response)
          }
          // Nothing waits after a restart, an interrupt, or for a widget shown without `wait`: tell the model.
          if (!waiter)
            yield* deliver(
              next,
              "response",
              responseText(next, response),
              "value" in response ? `Responded to "${label(next)}"` : `Dismissed "${label(next)}"`,
              true,
            )
          return { type: "ok", state: next } as Outcome
        }).pipe(Semaphore.withPermit(lock))
      })

      const send = Effect.fn("WidgetPlugin.send")(function* (call: Call, value: Schema.Json, wake: boolean) {
        return yield* Effect.gen(function* (): Effect.fn.Return<Outcome | { readonly type: "rate_limited" }> {
          const state = yield* read(call)
          if (!state) return { type: "not_found" } as Outcome
          if (state.status !== "open") return { type: "closed", status: state.status } as Outcome
          const now = yield* Clock.currentTimeMillis
          const recent = (recentSends.get(stateKey(call)) ?? []).filter((time) => now - time < RATE_WINDOW_MS)
          if (recent.length >= RATE_LIMIT) return { type: "rate_limited" } as const
          recentSends.set(stateKey(call), [...recent, now])
          yield* deliver(state, "message", messageText(state, value), messageDescription(state, value), wake)
          return { type: "ok", state } as Outcome
        }).pipe(Semaphore.withPermit(lock))
      })

      // Closes `old` because `by` replaces it: it can't be answered any more, and a call waiting on it ends.
      const supersede = Effect.fn("WidgetPlugin.supersede")(function* (old: Widget.State, by: Call) {
        return yield* Effect.gen(function* () {
          const state = yield* read(old)
          if (!state || state.status !== "open") return
          yield* write({
            ...state,
            status: "superseded",
            supersededBy: { messageID: by.messageID, callID: by.callID },
            time: { ...state.time, responded: yield* Clock.currentTimeMillis },
          })
          const waiter = waiters.get(stateKey(old))
          if (!waiter) return
          waiters.delete(stateKey(old))
          yield* Deferred.fail(waiter, new WaitFailure(`Widget "${label(state)}" was superseded by a newer widget.`))
        }).pipe(Semaphore.withPermit(lock))
      })

      // A client's program error is recorded on the widget. It reaches the model on its own only when the widget's
      // Session created the widget template version it runs; elsewhere only when the user asks (`ask`). Either way once: a
      // waiting call fails with it, otherwise a waking message.
      const report = Effect.fn("WidgetPlugin.report")(function* (
        call: Call,
        error: Widget.RuntimeError,
        client: string,
        ask: boolean,
      ) {
        return yield* Effect.gen(function* () {
          const state = yield* read(call)
          if (!state) return undefined
          if (state.status !== "open") return state
          const known = state.failure?.phase === error.phase && state.failure.message === error.message
          const failure: Widget.Failure = known && state.failure ? state.failure : { ...error, client, sent: false }
          const origin = yield* widgetTemplates.origin(state.widgetTemplate.name, state.widgetTemplate.version)
          const key = stateKey(call)
          const now = yield* Clock.currentTimeMillis
          const seen = reports.get(key) ?? { seen: new Set<string>(), last: -Infinity }
          const id = `${error.phase}\0${error.message}`
          const automatic = origin === state.sessionID && !seen.seen.has(id) && now - seen.last >= REPORT_WINDOW_MS
          const sending = !failure.sent && (ask || automatic)
          if (automatic) {
            seen.seen.add(id)
            seen.last = now
            reports.set(key, seen)
          }
          const next: Widget.State = { ...state, failure: sending ? { ...failure, sent: true } : failure }
          if (!known || sending) yield* write(next)
          if (!sending) return next
          const text = errorText(state, error, client) + (ask ? " The user asked you to fix it." : "")
          const waiter = waiters.get(key)
          if (waiter) {
            waiters.delete(key)
            yield* Deferred.fail(waiter, new WaitFailure(text))
            return next
          }
          yield* deliver(next, "error", text, `${label(state)} failed on ${client}`, true)
          return next
        }).pipe(Semaphore.withPermit(lock))
      })

      holder.rpc = yield* ctx.rpc
        .register(Widget.Definition, {
          widgetTemplates: () => widgetTemplates.list(),
          program: (input, call) =>
            (input.version === undefined
              ? widgetTemplates.latest(input.name)
              : widgetTemplates.get(input.name, input.version)
            ).pipe(Effect.mapError((error) => call.error("not_found", error.message, {}))),
          states: (input) => list(input.sessionID),
          instances: () => instances(),
          respond: (input, call) =>
            Effect.gen(function* () {
              const outcome = yield* respond(input, input.response)
              if (outcome.type === "not_found")
                return yield* Effect.fail(call.error("not_found", "Widget not found", {}))
              if (outcome.type === "closed")
                return yield* Effect.fail(
                  call.error("closed", `Widget was already ${outcome.status}`, { status: outcome.status }),
                )
              return outcome.state
            }),
          report: (input, call) =>
            report(input, input.error, input.client, input.ask === true).pipe(
              Effect.flatMap((state) =>
                state ? Effect.succeed(state) : Effect.fail(call.error("not_found", "Widget not found", {})),
              ),
            ),
          send: (input, call) =>
            Effect.gen(function* () {
              const outcome = yield* send(input, input.value, input.wake ?? true)
              if (outcome.type === "not_found")
                return yield* Effect.fail(call.error("not_found", "Widget not found", {}))
              if (outcome.type === "rate_limited")
                return yield* Effect.fail(
                  call.error("rate_limited", `A widget sends at most ${RATE_LIMIT} messages a second`, {}),
                )
              if (outcome.type === "closed")
                return yield* Effect.fail(
                  call.error("closed", `Widget was already ${outcome.status}`, { status: outcome.status }),
                )
              return outcome.state
            }),
        })
        .pipe(Effect.orDie)

      yield* ctx.skill.transform((editor) => {
        editor.add(
          Skill.Info.make({
            id: Skill.ID.make("widgets"),
            name: Skill.Name.make("Widgets"),
            description: WidgetTools.skillDescription,
            path: AbsolutePath.make("skill://widgets/SKILL.md"),
            content: skill,
          }),
        )
      })

      // Defaults only: rules from config are applied after built-in agents, so they still win.
      yield* ctx.agent.transform((editor) => {
        editor.update("build", (agent) => {
          agent.permissions.push(
            { action: WidgetTools.name, resource: "*", effect: "allow" },
            { action: WidgetTools.widgetTemplateName, resource: "*", effect: "allow" },
          )
        })
        editor.update("plan", (agent) => {
          agent.permissions.push({ action: WidgetTools.name, resource: "*", effect: "allow" })
        })
        // A subagent has no one to show a widget to.
        editor.update("general", (agent) => {
          agent.permissions.push({ action: WidgetTools.name, resource: "*", effect: "deny" })
        })
      })

      yield* ctx.tool.transform((editor) => {
        editor.add({
          name: WidgetTools.name,
          options: { codemode: false },
          description: WidgetTools.description,
          input: WidgetTools.Input,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* ctx.permission.assert({
                sessionID: context.sessionID,
                agent: context.agent,
                action: WidgetTools.name,
                resources: [input.widgetTemplate],
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const widgetTemplate = yield* widgetTemplates.latest(input.widgetTemplate).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Error({
                      message: `${error.message}. Use widget_template with action "list" to see the widget templates.`,
                    }),
                ),
              )
              yield* widgetTemplates.check(widgetTemplate, input.data).pipe(Effect.mapError(toolError))
              const replaced =
                input.replaces === undefined
                  ? undefined
                  : (yield* list(context.sessionID)).find((state) => state.callID === input.replaces)
              if (input.replaces !== undefined && !replaced)
                return yield* new Tool.Error({
                  message: `No widget with call ID "${input.replaces}" in this session to replace. Omit replaces to show a new widget.`,
                })
              yield* widgetTemplates.remember(widgetTemplate)
              const ref = { name: widgetTemplate.name, version: widgetTemplate.version }
              const state: Widget.State = {
                sessionID: context.sessionID,
                messageID: context.messageID,
                callID: context.id,
                widgetTemplate: ref,
                ...(input.title === undefined ? {} : { title: input.title }),
                status: "open",
                wait: input.wait === true,
                ...(widgetTemplate.capabilities === undefined ? {} : { capabilities: widgetTemplate.capabilities }),
                time: { created: yield* Clock.currentTimeMillis },
              }
              if (replaced) yield* supersede(replaced, state)
              if (!state.wait) {
                yield* write(state).pipe(Semaphore.withPermit(lock))
                return { content: WidgetTools.shownText(label(state), state.callID), metadata: { widgetTemplate: ref } }
              }
              const response = yield* wait(state, context.cancel)
              if (!("value" in response))
                return yield* new Tool.Error({
                  message: responseText(state, response),
                  metadata: { widgetTemplate: ref },
                })
              return {
                content: responseText(state, response),
                metadata: { widgetTemplate: ref, response: response.value },
              }
            }),
        })
        editor.add({
          name: WidgetTools.widgetTemplateName,
          options: { codemode: false },
          description: WidgetTools.widgetTemplateDescription,
          input: WidgetTools.WidgetTemplateInput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* ctx.permission.assert({
                sessionID: context.sessionID,
                agent: context.agent,
                action: WidgetTools.widgetTemplateName,
                resources: [input.action === "list" ? "*" : (input.name ?? "*")],
                metadata: { action: input.action },
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              if (input.action === "list") {
                const all = yield* widgetTemplates.list()
                return { content: JSON.stringify(all, null, 2), metadata: { action: "list", count: all.length } }
              }
              const required = <A>(field: string, value: A | undefined) =>
                value === undefined
                  ? Effect.fail(new Tool.Error({ message: `\`${field}\` is required for action "${input.action}"` }))
                  : Effect.succeed(value)
              const named = yield* required("name", input.name)
              // Short metadata, so clients show these calls as one quiet line instead of the source.
              const summary = Effect.fnUntraced(function* (widgetTemplate: Widget.WidgetTemplate) {
                const revision = yield* widgetTemplates.revision(widgetTemplate.name, widgetTemplate.version)
                return {
                  action: input.action,
                  name: widgetTemplate.name,
                  version: widgetTemplate.version,
                  ...(revision === undefined ? {} : { revision }),
                  lines: widgetTemplate.source.split("\n").length,
                }
              })
              if (input.action === "get") {
                const widgetTemplate = yield* widgetTemplates.latest(named).pipe(Effect.mapError(toolError))
                return {
                  content: JSON.stringify(WidgetTemplates.withoutProgram(widgetTemplate), null, 2),
                  metadata: yield* summary(widgetTemplate),
                }
              }
              const saved =
                input.action === "edit"
                  ? yield* widgetTemplates
                      .edit({
                        name: named,
                        ...(input.from === undefined ? {} : { from: input.from }),
                        edits: yield* required("edits", input.edits),
                        ...(input.description === undefined ? {} : { description: input.description }),
                        ...(input.data === undefined ? {} : { data: input.data }),
                        ...(input.example === undefined ? {} : { example: input.example }),
                        origin: context.sessionID,
                      })
                      .pipe(Effect.mapError(toolError))
                  : yield* widgetTemplates
                      .save({
                        name: named,
                        description: yield* required("description", input.description),
                        data: yield* required("data", input.data),
                        source: yield* required("source", input.source),
                        ...(input.mode === undefined ? {} : { mode: input.mode }),
                        ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
                        example: yield* required("example", input.example),
                        origin: context.sessionID,
                      })
                      .pipe(Effect.mapError(toolError))
              const metadata = yield* summary(saved)
              const verb = input.action === "edit" ? "Edited" : "Saved"
              return {
                content: `${verb} widget template "${saved.name}" version ${saved.version} (revision ${metadata.revision}, ${metadata.lines} lines). Show it with the widget tool.`,
                metadata,
              }
            }),
        })
      })

      // Posts the widget and waits for its answer. The waiter is registered before the state is written, so an answer
      // that arrives at once finds it; it is removed under the lock, so an answer reaches either this call or the model.
      const wait = Effect.fnUntraced(function* (state: Widget.State, cancel: Effect.Effect<void> | undefined) {
        const key = stateKey(state)
        const answered = yield* Deferred.make<Widget.Response, WaitFailure>()
        waiters.set(key, answered)
        return yield* Effect.gen(function* () {
          yield* write(state).pipe(Semaphore.withPermit(lock))
          // A client's error report fails the call, so the model fixes the widget template and posts it again.
          const answer = Deferred.await(answered).pipe(
            Effect.mapError((error) => new Tool.Error({ message: error.text })),
            Effect.map(Option.some),
          )
          const result = cancel ? yield* Effect.raceFirst(answer, cancel.pipe(Effect.as(Option.none()))) : yield* answer
          if (Option.isSome(result)) return result.value
          return yield* new Tool.Error({
            message: `Stopped waiting for widget "${label(state)}". It stays open; its answer arrives as a message.`,
          })
        }).pipe(Effect.ensuring(Effect.sync(() => waiters.delete(key)).pipe(Semaphore.withPermit(lock))))
      })

      // A deleted Session's widgets go with it.
      yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            let after: string | undefined
            do {
              const page = yield* ctx.storage.scan({ prefix: `state:${event.data.sessionID}:`, after, limit: 100 })
              yield* Effect.forEach(page.entries, (entry) => ctx.storage.remove(entry.key), { discard: true })
              after = page.next
            } while (after !== undefined)
          }),
        ),
        Effect.catchCause((cause) => Effect.logWarning("failed to remove a deleted session's widgets", { cause })),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
}) satisfies Plugin.Plugin

function toolError(error: { readonly message: string }) {
  return new Tool.Error({ message: error.message })
}
