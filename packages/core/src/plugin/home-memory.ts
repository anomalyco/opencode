export * as HomeMemoryPlugin from "./home-memory.js"

import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionID } from "@opencode/schema/session-id"
import type { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Clock, DateTime, Effect, Option, Schema } from "effect"
import path from "path"
import { Flag } from "../flag.js"
import { Reference } from "../reference.js"

const DAY = 24 * 60 * 60 * 1000
const MESSAGE_LIMIT = 4_000
const SESSION_LIMIT = 40_000
const TOTAL_LIMIT = 200_000

const State = Schema.Struct({ session: SessionID, last: Schema.Finite })
const decodeState = Schema.decodeUnknownOption(State)

const description = (directory: string) =>
  [
    "Your own long-term workspace for helping this user across sessions. It persists between conversations and nothing in it is loaded automatically, so look here before asking the user something they may have told you before, and before redoing work.",
    `- ${path.join(directory, "memory")}: what you know about the user and want to remember: preferences, people, accounts, decisions, corrections they gave you.`,
    `- ${path.join(directory, "docs")}: documents you write or manage for the user.`,
    `- ${path.join(directory, "scripts")}: reusable scripts you build for recurring tasks.`,
    "Read, write, reorganize and delete anything in it whenever it helps. Keep files small and well named so grep finds them. Don't use it for throwaway scratch work.",
  ].join("\n")

const maintenance = (directory: string, transcripts: string) => `Daily memory maintenance. Nobody is watching; don't ask questions.

Your workspace is ${directory}, with memory/, docs/ and scripts/ folders. Below are the conversations the user had in their home folder since the last run (user and assistant text only, long messages cut).

1. Pick up anything worth remembering that isn't saved yet: preferences, facts about the user and the people and things in their life, decisions, corrections, recurring tasks. Skip one-off details and anything already saved.
2. Update what changed and delete what's stale or wrong.
3. Reorganize: merge duplicates, split files that grew too big, rename unclear files, keep the layout easy to grep.

Work only inside ${directory}. Finish with a short summary of what you added, changed and removed.

<conversations>
${transcripts}
</conversations>`

export const Plugin = define({
  id: "opencode.home-memory",
  effect: Effect.fn("HomeMemoryPlugin")(function* (ctx) {
    if (!(yield* Flag.enabled("home_memory"))) return
    const global = yield* Global.Service
    if (path.resolve(ctx.location.directory) !== path.resolve(global.home)) return
    const fs = yield* FSUtil.Service
    const directory = path.join(global.data, "memory", ctx.location.project.id)
    yield* Effect.forEach(["memory", "docs", "scripts"], (name) => fs.ensureDir(path.join(directory, name)), {
      discard: true,
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to create home memory folders", { cause })))

    yield* ctx.reference.transform((editor) => {
      editor.add(
        "memory",
        Reference.LocalSource.make({
          type: "local",
          path: AbsolutePath.make(directory),
          description: description(directory),
        }),
      )
    })

    const key = `state/${ctx.location.project.id}`

    // Locations unload when idle, so this runs at most daily and only while the home folder is in use.
    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const state = decodeState(yield* ctx.storage.get(key)).pipe(Option.getOrUndefined)
      if (state && now - state.last < DAY) return
      const session = yield* existing(state?.session)
      const since = state?.last ?? now - DAY
      const transcripts = yield* collect(since, session)
      yield* ctx.storage.set(key, { session, last: now })
      if (transcripts.length === 0) return
      yield* ctx.session.prompt({ sessionID: session, text: maintenance(directory, transcripts), delivery: "queue" })
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("home memory maintenance failed", { cause })))

    const existing = Effect.fnUntraced(function* (sessionID: SessionID | undefined) {
      if (sessionID) {
        const found = yield* ctx.session.get({ sessionID }).pipe(Effect.option)
        if (Option.isSome(found)) return found.value.id
      }
      const created = yield* ctx.session.create({ title: "Memory maintenance" })
      return created.id
    })

    const collect = Effect.fnUntraced(function* (since: number, exclude: SessionID) {
      const page = yield* ctx.session.list({
        directory: AbsolutePath.make(ctx.location.directory),
        parentID: null,
        order: "desc",
        limit: 100,
      })
      const recent = page.data.filter(
        (session) => session.id !== exclude && DateTime.toEpochMillis(session.time.updated) > since,
      )
      const sections = yield* Effect.forEach(recent, (session) =>
        ctx.session.context({ sessionID: session.id }).pipe(
          Effect.map((messages) => transcript(session.title ?? session.id, messages)),
          Effect.orElseSucceed(() => ""),
        ),
      )
      return sections
        .filter((section) => section.length > 0)
        .reduce((all, section) => (all.length + section.length > TOTAL_LIMIT ? all : `${all}${section}\n\n`), "")
        .trim()
    })

    yield* tick.pipe(Effect.andThen(Effect.sleep("1 hour")), Effect.forever, Effect.forkScoped)
  }),
})

function transcript(title: string, messages: readonly SessionMessage.Info[]) {
  const lines = messages.flatMap((message) => {
    if (message.type === "user") return [`user: ${cut(message.text)}`]
    if (message.type !== "assistant") return []
    const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    return text.length === 0 ? [] : [`assistant: ${cut(text)}`]
  })
  if (!lines.some((line) => line.startsWith("user: "))) return ""
  const body = lines.join("\n")
  return `<conversation title="${title.replaceAll('"', "'")}">\n${body.length > SESSION_LIMIT ? body.slice(-SESSION_LIMIT) : body}\n</conversation>`
}

function cut(text: string) {
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)} [cut]` : text
}
