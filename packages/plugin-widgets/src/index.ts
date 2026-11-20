/// <reference path="./markdown.d.ts" />

import { Plugin } from "@opencode/plugin/effect"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Skill } from "@opencode/schema/skill"
import { Tool } from "@opencode/schema/tool"
import { Widget } from "@opencode/schema/widget"
import { Clock, Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import skill from "./skill.md" with { type: "text" }
import { WidgetTemplates } from "./templates.js"
import { WidgetTools } from "./tools.js"

export { WidgetTemplates } from "./templates.js"
export { WidgetTools } from "./tools.js"

export const id = "opencode.widget"

/** At most this many `send` messages per widget within {@link RATE_WINDOW_MS}. */
export const RATE_LIMIT = 10
export const RATE_WINDOW_MS = 1000

type Call = { readonly sessionID: string; readonly messageID: string; readonly callID: string }

// Process-wide rather than per activation, so a plugin reload or another Location's instance still finds a waiting
// call. Keys are a widget's storage key.
const waiters = new Map<string, Deferred.Deferred<Widget.Response>>()
const recentSends = new Map<string, number[]>()
// Serializes every state change and its delivery, so a widget is answered once, never sends after its answer, and its
// messages reach the model in order. Process-local: one server process per database.
const lock = Semaphore.makeUnsafe(1)

const stateKey = (call: Call) => `state:${call.sessionID}:${call.messageID}:${call.callID}`
const decodeState = Schema.decodeUnknownOption(Widget.State)
const encodeState = Schema.encodeSync(Widget.State)

const label = (state: Pick<Widget.State, "title" | "template">) => state.title ?? state.template.name

export const responseText = (state: Pick<Widget.State, "title" | "template">, response: Widget.Response) =>
  "value" in response
    ? `User responded to widget "${label(state)}": ${JSON.stringify(response.value)}`
    : `User dismissed widget "${label(state)}"`

export const messageText = (state: Pick<Widget.State, "title" | "template">, value: unknown) =>
  `Widget "${label(state)}" sent: ${JSON.stringify(value)}`

const messageDescription = (state: Pick<Widget.State, "title" | "template">, value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return `${label(state)}: ${text.length > 80 ? text.slice(0, 79) + "…" : text}`
}

export default Plugin.define({
  id,
  effect: (ctx) =>
    Effect.gen(function* () {
      const templates = WidgetTemplates.make(ctx.storage)
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

      const list = Effect.fn("WidgetPlugin.list")(function* (sessionID: string) {
        const states: Widget.State[] = []
        let after: string | undefined
        do {
          const page = yield* ctx.storage.scan({ prefix: `state:${sessionID}:`, after, limit: 100 })
          for (const entry of page.entries) {
            const state = Option.getOrUndefined(decodeState(entry.value))
            if (state) states.push(state)
          }
          after = page.next
        } while (after !== undefined)
        return states.toSorted((a, b) => a.time.created - b.time.created)
      })

      // Admitted as a steered synthetic message, so it reaches the model like a prompt: an idle Session wakes into a
      // turn, a busy one takes it at its next step. `resume: false` admits it without waking.
      const deliver = (
        state: Widget.State,
        kind: "response" | "message",
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
        | { readonly type: "closed"; readonly status: "submitted" | "dismissed" }
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

      holder.rpc = yield* ctx.rpc
        .register(Widget.Definition, {
          templates: () => templates.list(),
          program: (input, call) =>
            (input.version === undefined
              ? templates.latest(input.name)
              : templates.get(input.name, input.version)
            ).pipe(
              Effect.map(WidgetTemplates.toProgram),
              Effect.mapError((error) => call.error("not_found", error.message, {})),
            ),
          states: (input) => list(input.sessionID),
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
            { action: WidgetTools.templateName, resource: "*", effect: "allow" },
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
                resources: [input.template],
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const template = yield* templates.latest(input.template).pipe(
                Effect.mapError(
                  (error) =>
                    new Tool.Error({
                      message: `${error.message}. Use widget_template with action "list" to see the templates.`,
                    }),
                ),
              )
              yield* templates.check(template, input.data).pipe(Effect.mapError(toolError))
              yield* templates.remember(template)
              const ref = { name: template.name, version: template.version }
              const state: Widget.State = {
                sessionID: context.sessionID,
                messageID: context.messageID,
                callID: context.id,
                template: ref,
                ...(input.title === undefined ? {} : { title: input.title }),
                status: "open",
                wait: input.wait === true,
                time: { created: yield* Clock.currentTimeMillis },
              }
              if (!state.wait) {
                yield* write(state).pipe(Semaphore.withPermit(lock))
                return { content: WidgetTools.shownText(label(state)), metadata: { template: ref } }
              }
              const response = yield* wait(state, context.cancel)
              if (!("value" in response))
                return yield* new Tool.Error({ message: responseText(state, response), metadata: { template: ref } })
              return { content: responseText(state, response), metadata: { template: ref, response: response.value } }
            }),
        })
        editor.add({
          name: WidgetTools.templateName,
          options: { codemode: false },
          description: WidgetTools.templateDescription,
          input: WidgetTools.TemplateInput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* ctx.permission.assert({
                sessionID: context.sessionID,
                agent: context.agent,
                action: WidgetTools.templateName,
                resources: [input.action === "list" ? "*" : (input.name ?? "*")],
                metadata: { action: input.action },
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              if (input.action === "list") return { content: JSON.stringify(yield* templates.list(), null, 2) }
              const required = <A>(field: string, value: A | undefined) =>
                value === undefined
                  ? Effect.fail(new Tool.Error({ message: `\`${field}\` is required for action "${input.action}"` }))
                  : Effect.succeed(value)
              const named = yield* required("name", input.name)
              if (input.action === "get") {
                const template = yield* templates.latest(named).pipe(Effect.mapError(toolError))
                return { content: JSON.stringify(template, null, 2) }
              }
              const saved = yield* templates
                .save({
                  name: named,
                  description: yield* required("description", input.description),
                  data: yield* required("data", input.data),
                  source: yield* required("source", input.source),
                  ...(input.mode === undefined ? {} : { mode: input.mode }),
                  example: yield* required("example", input.example),
                })
                .pipe(Effect.mapError(toolError))
              return {
                content: `Saved widget template "${saved.name}" version ${saved.version}. Show it with the widget tool.`,
                metadata: { name: saved.name, version: saved.version },
              }
            }),
        })
      })

      // Posts the widget and waits for its answer. The waiter is registered before the state is written, so an answer
      // that arrives at once finds it; it is removed under the lock, so an answer reaches either this call or the model.
      const wait = Effect.fnUntraced(function* (state: Widget.State, cancel: Effect.Effect<void> | undefined) {
        const key = stateKey(state)
        const answered = yield* Deferred.make<Widget.Response>()
        waiters.set(key, answered)
        return yield* Effect.gen(function* () {
          yield* write(state).pipe(Semaphore.withPermit(lock))
          const answer = Deferred.await(answered).pipe(Effect.map(Option.some))
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
