export * as TunnelTool from "./tunnel.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Layer, Option, Predicate, Schema } from "effect"
import { Agent } from "../../agent.js"
import { App } from "../../app.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionTunnel } from "../../session/tunnel.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionMessage } from "../../session/message.js"

export const name = "tunnel"

export const Input = Schema.Struct({
  to: Schema.optionalKey(SessionSchema.ID).annotate({
    description: "The session to message. Omit to report to the direct parent session.",
  }),
  kind: Schema.optionalKey(Schema.Literals(["message", "report"])).annotate({
    description:
      '"message" for a peer message within the family, "report" for a status report to an ancestor. Defaults to "report" when `to` is omitted, "message" otherwise.',
  }),
  body: Schema.String.annotate({
    description: "The message content to deliver. The recipient sees it as new user input.",
  }),
})

export const Output = Schema.Struct({
  id: SessionMessage.ID,
  to: SessionSchema.ID,
  kind: Schema.Literals(["message", "report"]),
  status: Schema.Literals(["sent"]),
})
export const description = [
  "Sends a message to another session in this session's family: its parent, a sibling subagent, or one of its own subagents.",
  "The recipient sees the message as new input, exactly like a user typing it: a running recipient is steered by it at the next step boundary, and an idle recipient wakes to process it.",
  'Omit `to` to report to the direct parent session (kind "report"); pass `to` to message that session (kind "message").',
  "Use it to hand off findings, ask a family member for information it is better placed to answer, or report progress to the parent.",
].join("\n")

/** What permission rules name for a target: its agent when it has one, otherwise the session id. */
const targetResource = (session: SessionSchema.Info) => session.agent ?? session.id

export const Plugin = {
  id: "opencode.tool.tunnel",
  effect: Effect.fn("TunnelTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const tunnel = yield* SessionTunnel.Service
    const permission = yield* Permission.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.resolver
    const enabled = () => flags(loaded.entries).agent_tunnel.enabled
    // Registration follows the flag (the tool is absent while it is off). The per-call
    // `Flag.enabled` keeps a session that outlived a config change honest; the captured live
    // Config instance reads fresh entries on every evaluation.
    const flagScope = Layer.mergeAll(
      Layer.succeed(App.Metadata, yield* App.Metadata),
      Layer.succeed(Flag.Overrides, yield* Flag.Overrides),
      Layer.succeed(Config.Service, config),
    )
    const flagEnabled = Effect.provide(Flag.enabled("agent_tunnel"), flagScope)

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (!(yield* flagEnabled))
                return yield* new ToolFailure({
                  message: 'The tunnel tool is disabled. Enable the "agent_tunnel" flag to message other sessions.',
                })
              const current = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: "Session not found", error })),
                )
              const kind = input.kind ?? (input.to === undefined ? "report" : "message")
              // Omitting `to` addresses the direct parent, which only makes sense for reports.
              const targetID = input.to ?? (kind === "report" ? current.parentID : undefined)
              if (targetID === undefined)
                return yield* new ToolFailure({
                  message:
                    kind === "report"
                      ? "This session has no parent session to report to."
                      : "A peer message requires the target session's id in `to`.",
                })
              const target = yield* sessions
                .get(targetID)
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: `Session not found: ${targetID}`, error })),
                )
              const resource = targetResource(target)
              yield* permission
                .assert({
                  action: name,
                  resources: [resource],
                  save: [resource],
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Tunnel message denied: ${resource}`, error }),
                  ),
                )
              const message = yield* tunnel
                .send({ from: context.sessionID, to: targetID, kind, body: input.body })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new ToolFailure({
                        message: `Failed to send tunnel message to ${targetID}: ${error.message}`,
                        error,
                      }),
                  ),
                )
              return {
                output: { id: message.id, to: targetID, kind: message.kind, status: "sent" as const },
                content: [
                  `Message delivered to session ${targetID}.`,
                  "The recipient sees it as new input: a running recipient is steered by it at the next step boundary, and an idle recipient wakes to process it.",
                  "Continue your own work; do not wait for a reply unless you were asked to.",
                ].join("\n"),
                metadata: { to: targetID, kind: message.kind, id: message.id },
              }
            }),
        })
      })
      .pipe(Effect.orDie)

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.sync(() => {
        if (event.tool !== name || !Predicate.isObject(event.input)) return
        if (event.input.to !== "") return
        const input = { ...event.input }
        delete input.to
        event.input = input
      }),
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        if (!enabled()) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const members = yield* tunnel.family(event.sessionID).pipe(Effect.option)
        if (Option.isNone(members)) return
        const targets = members.value
          .filter((member) => member.id !== event.sessionID)
          .filter(
            (member) => Permission.evaluate(name, targetResource(member), selected.permissions).effect !== "deny",
          )
        if (targets.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Family sessions this session can message:",
          ...targets.map(
            (member) =>
              `- ${member.id} (agent: ${member.agent ?? "unknown"}${member.title ? `, "${member.title}"` : ""})`,
          ),
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
