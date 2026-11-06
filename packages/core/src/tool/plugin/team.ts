export * as TeamTool from "./team.js"

import { SystemPart, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionTeam } from "../../session/team.js"

const peerToolDescription = [
  "Sends a message to an entry of your current team roster. The message is delivered while the recipient is running (at its next step boundary) or wakes it up if it is idle.",
  "You can only message entries in your roster. Call team_roster to see who is available.",
].join("\n")

const rosterToolDescription = [
  "Shows your current team roster: member names and roles. The leader is the only member that can message Boss; the leader's roster also includes Boss.",
].join("\n")

const rosterLine = (entry: SessionTeam.Entry, self: boolean) => {
  const note = entry.role === "leader" ? " (leader) — the only member who can message Boss" : " (member)"
  return `- ${entry.name}${note}${self ? " — you" : ""}`
}

const renderMemberRoster = (membership: SessionTeam.Membership, entries: readonly SessionTeam.Entry[]) => [
  `Team ${membership.teamID}:`,
  ...entries.map((entry) => rosterLine(entry, entry.sessionID === membership.sessionID)),
]

const renderLeaderRoster = (membership: SessionTeam.Membership, entries: readonly SessionTeam.Entry[]) => [
  ...renderMemberRoster(membership, entries),
  "- Boss — your manager; only you (the leader) can message it",
]

const renderBossRoster = (teams: readonly SessionTeam.Team[]) =>
  teams.flatMap((team) => [`Team ${team.teamID}:`, ...team.entries.map((entry) => rosterLine(entry, false))])

type Sender =
  | { readonly kind: "boss"; readonly sessionID: SessionSchema.ID; readonly teams: readonly SessionTeam.Team[] }
  | { readonly kind: "leader"; readonly membership: SessionTeam.Membership }
  | { readonly kind: "member"; readonly membership: SessionTeam.Membership }

const memberRules = (membership: SessionTeam.Membership) =>
  [
    `You are ${membership.name} (${membership.role}) in team ${membership.teamID}.`,
    "",
    "Rules:",
    "- Communicate with teammates using message_to_peer. You can only message entries in the current team roster; other sessions do not exist for you.",
    "- The roster can grow as members join. Call team_roster to see current members.",
    "- Idle is a normal state. Incoming messages wake you automatically; do not poll or wait in a loop.",
    "- When your part is done, send your result to the relevant teammate (or Boss if you are the leader).",
  ].join("\n")

export const Plugin = {
  id: "opencode.tool.team",
  effect: Effect.fn("TeamTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const team = yield* SessionTeam.Service

    const resolveSender = (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const membership = yield* team.membership(sessionID)
        if (membership) {
          if (membership.role === "leader") return { kind: "leader", membership } satisfies Sender
          return { kind: "member", membership } satisfies Sender
        }
        const teams = yield* team.teamsOf(sessionID)
        if (teams.length > 0) return { kind: "boss", sessionID, teams } satisfies Sender
        return undefined
      })

    const renderRoster = (sender: Sender) =>
      Effect.gen(function* () {
        if (sender.kind === "boss") return renderBossRoster(sender.teams)
        const entries = yield* team.roster(sender.membership)
        if (sender.kind === "leader") return renderLeaderRoster(sender.membership, entries)
        return renderMemberRoster(sender.membership, entries)
      })

    const rosterError = (to: string, sender: Sender) =>
      Effect.gen(function* () {
        const lines = yield* renderRoster(sender)
        return yield* new ToolFailure({
          message: [`No roster entry named "${to}". Current roster:`, ...lines].join("\n"),
        })
      })

    const resolveRecipient = (sender: Sender, to: string) =>
      Effect.gen(function* () {
        if (sender.kind === "boss") {
          const matches = sender.teams
            .flatMap((team) => team.entries)
            .filter((entry) => entry.name === to)
            .map((entry) => entry.sessionID)
          if (matches.length > 1)
            return yield* new ToolFailure({
              message: `Recipient "${to}" exists in multiple teams. Message one team at a time or use a name unique across your teams.`,
            })
          return matches[0]
        }
        if (to === "Boss" && sender.kind === "leader") return sender.membership.parentID
        const entries = yield* team.roster(sender.membership)
        return entries.find((entry) => entry.name === to)?.sessionID
      })

    const peerSenderLabel = (sender: Sender) =>
      sender.kind === "boss" ? "From Boss:" : `From ${sender.membership.name} (${sender.membership.role}):`

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "message_to_peer",
          options: { codemode: false },
          description: peerToolDescription,
          input: Schema.Struct({
            to: Schema.String.annotate({
              description: 'Recipient name from your current team roster (for example "Agent-1" or "Boss").',
            }),
            text: Schema.String.annotate({ description: "The message to send." }),
          }),
          output: Schema.Struct({ output: Schema.String }),
          execute: (input, context) =>
            Effect.gen(function* () {
              const sender = yield* resolveSender(context.sessionID)
              if (!sender)
                return yield* new ToolFailure({
                  message: "message_to_peer is only available to members of a team or a session that spawned a team.",
                })
              const target = yield* resolveRecipient(sender, input.to)
              if (target === undefined) return yield* rosterError(input.to, sender)
              const text = [peerSenderLabel(sender), input.text].join("\n")
              yield* sessions
                .prompt({
                  sessionID: target,
                  text,
                  metadata: { source: "message_to_peer", from: input.to },
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to deliver message to ${input.to}`, error }),
                  ),
                )
              return {
                output: { output: `Message sent to ${input.to}.` },
                content: `Message sent to ${input.to}.`,
                metadata: { to: input.to, sessionID: target },
              }
            }),
        })
        editor.add({
          name: "team_roster",
          options: { codemode: false },
          description: rosterToolDescription,
          input: Schema.Struct({}),
          output: Schema.Struct({ output: Schema.String }),
          execute: (_input, context) =>
            Effect.gen(function* () {
              const sender = yield* resolveSender(context.sessionID)
              if (!sender)
                return yield* new ToolFailure({
                  message: "team_roster is only available to members of a team or a session that spawned a team.",
                })
              const lines = yield* renderRoster(sender)
              return {
                output: { output: lines.join("\n") },
                content: lines.join("\n"),
                metadata: {},
              }
            }),
        })
      })
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const membership = yield* team.membership(event.sessionID)
        if (!membership) return
        event.system.splice(1, 0, SystemPart.make(memberRules(membership)))
      }),
    )
  }),
}
