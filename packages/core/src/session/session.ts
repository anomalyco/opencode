export * as Session from "./session.js"

import { Effect, Layer } from "effect"
import { Base64, FileAttachment, Prompt } from "@opencode-ai/schema/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Event } from "@opencode-ai/schema/event"
import type { Info } from "@opencode-ai/schema/shell"
import { FSUtil } from "@opencode-ai/util/fs-util"
import path from "path"
import { fileURLToPath } from "url"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Image } from "../image.js"
import { Location } from "../location.js"
import { Mime } from "../mime.js"
import { PluginHooks } from "../plugin/hooks.js"
import { PluginSupervisor } from "../plugin/supervisor-service.js"
import { Shell } from "../shell.js"
import { Skill } from "../skill.js"
import {
  AttachmentError,
  BusyError,
  CompactionConflictError,
  InboxConflictError,
  NotFoundError,
  PromptConflictError,
  SkillNotFoundError,
  SyntheticConflictError,
} from "./error.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionRevert } from "./revert.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export type Services =
  | PluginSupervisor.Service
  | PluginHooks.Service
  | Image.Service
  | Skill.Service
  | SessionRevert.Service
  | Shell.Service

type PromptRequest = {
  id?: SessionMessage.ID
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  metadata?: Record<string, unknown>
  delivery?: SessionInbox.Delivery
  resume?: boolean
}

/**
 * Build once per host: `const sessions = yield* Session.make(servicesFor)`.
 * Use `sessions.forSession(id)` for handles that share gates and reload current state.
 */
export const make = Effect.fn("Session.make")(function* (servicesFor: (ref: Location.Ref) => Layer.Layer<Services>) {
  const database = yield* Database.Service
  const db = database.db
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const execution = yield* SessionExecution.Service
  const fs = yield* FSUtil.Service
  const manualShellSessions = new Set<SessionSchema.ID>()
  const shellLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

  const get = Effect.fn("Session.get")(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session) return yield* new NotFoundError({ sessionID })
    return session
  })
  const mutatePending = (
    sessionID: SessionSchema.ID,
    inboxID: SessionMessage.ID,
    mutation: (
      bus: Bus.Interface,
      input: { readonly id: SessionMessage.ID; readonly sessionID: SessionSchema.ID },
    ) => Effect.Effect<void, SessionInbox.LifecycleConflict>,
  ) =>
    mutation(bus, { sessionID, id: inboxID }).pipe(
      Effect.catchTag("SessionInbox.LifecycleConflict", () =>
        Effect.gen(function* () {
          yield* get(sessionID)
          return yield* new InboxConflictError({ sessionID, inboxID })
        }),
      ),
    )

  const inbox = Effect.fn("Session.inbox")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    return yield* SessionInbox.list(db, sessionID)
  })
  const cancelInbox = Effect.fn("Session.cancelInbox")(
    (sessionID: SessionSchema.ID, inboxID: SessionMessage.ID) => mutatePending(sessionID, inboxID, SessionInbox.cancel),
    Effect.uninterruptible,
  )
  const steerInbox = Effect.fn("Session.steerInbox")(function* (
    sessionID: SessionSchema.ID,
    inboxID: SessionMessage.ID,
  ) {
    yield* mutatePending(sessionID, inboxID, SessionInbox.steer)
    yield* execution.wake(sessionID)
  }, Effect.uninterruptible)
  const queueInbox = Effect.fn("Session.queueInbox")(
    (sessionID: SessionSchema.ID, inboxID: SessionMessage.ID) => mutatePending(sessionID, inboxID, SessionInbox.queue),
    Effect.uninterruptible,
  )
  const prompt = Effect.fn("Session.prompt")((sessionID: SessionSchema.ID, input: PromptRequest) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const session = yield* get(sessionID)
        const messageID = input.id ?? SessionMessage.ID.create()
        const admitted = yield* Effect.gen(function* () {
          const existing = yield* SessionInbox.reconcile(db, {
            id: messageID,
            sessionID: session.id,
            type: "user",
            delivery: input.delivery ?? "steer",
          })
          if (existing) return existing
          const item = yield* restore(
            preparePrompt({ ...input, sessionID }, messageID).pipe(Effect.provide(servicesFor(session.location))),
          )
          // Commit a staged revert only after preparation succeeds, before admitting new work.
          if (session.revert) yield* SessionRevert.commit(bus, session)
          return yield* SessionInbox.admit(db, bus, {
            id: messageID,
            sessionID: session.id,
            item,
          })
        }).pipe(
          Effect.catchTag("SessionInbox.LifecycleConflict", () => new PromptConflictError({ sessionID, messageID })),
        )
        if (input.resume !== false && !manualShellSessions.has(sessionID)) yield* execution.wake(sessionID)
        return admitted
      }),
    ),
  )
  const shell = Effect.fn("Session.shell")(function* (
    sessionID: SessionSchema.ID,
    input: { id?: Event.ID; command: string },
  ) {
    const session = yield* get(sessionID)
    yield* shellLocks.withLock(sessionID)(
      Effect.gen(function* () {
        manualShellSessions.add(sessionID)
        yield* execution.awaitIdle(sessionID)
        const started = yield* Effect.gen(function* () {
          const plugins = yield* PluginSupervisor.Service
          yield* plugins.flush
          const shell = yield* Shell.Service
          return yield* shell
            .create({
              command: input.command,
              cwd: session.location.directory,
              timeout: 0,
              metadata: { sessionID },
            })
            .pipe(Effect.orDie)
        }).pipe(Effect.provide(servicesFor(session.location)))
        yield* bus.publish(
          SessionEvent.Shell.Started,
          {
            sessionID,
            shell: started,
          },
          { id: input.id },
        )
        const completed = yield* Effect.gen(function* () {
          const shell = yield* Shell.Service
          const terminal = yield* shell.wait(started.id).pipe(
            Effect.map((info) => ({ info, retained: true as const })),
            Effect.catchTag("Shell.NotFoundError", () =>
              Effect.succeed({ info: synthesizeTerminalShellInfo(started), retained: false as const }),
            ),
          )
          const output = terminal.retained
            ? yield* shell
                .output(started.id, { limit: SHELL_MAX_CAPTURE_BYTES })
                .pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(missingShellOutput())))
            : missingShellOutput()
          return { shell: terminal.info, output }
        }).pipe(Effect.provide(servicesFor(session.location)))
        yield* bus.publish(SessionEvent.Shell.Ended, {
          sessionID,
          shell: completed.shell,
          output: completed.output,
        })
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            manualShellSessions.delete(sessionID)
            yield* execution.wake(sessionID)
          }),
        ),
      ),
    )
  })
  const compact = Effect.fn("Session.compact")(function* (
    sessionID: SessionSchema.ID,
    input: { id?: SessionMessage.ID; delivery?: SessionInbox.Delivery },
  ) {
    yield* get(sessionID)
    const inputID = input.id ?? SessionMessage.ID.create()
    const admitted = yield* SessionInbox.admitCompaction(db, bus, {
      id: inputID,
      sessionID,
      delivery: input.delivery ?? "steer",
    }).pipe(
      Effect.catchTag("SessionInbox.LifecycleConflict", () => new CompactionConflictError({ sessionID, inputID })),
    )
    yield* execution.wake(sessionID)
    return admitted
  })
  const wait = Effect.fn("Session.wait")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    yield* execution.awaitIdle(sessionID)
  })
  const resume = Effect.fn("Session.resume")(function* (sessionID: SessionSchema.ID) {
    yield* get(sessionID)
    yield* execution.resume(sessionID)
  })
  const synthetic = Effect.fn("Session.synthetic")(
    (
      sessionID: SessionSchema.ID,
      input: {
        id?: SessionMessage.ID
        text: string
        description?: string
        metadata?: Record<string, unknown>
        delivery?: SessionInbox.Delivery
        resume?: boolean
      },
    ) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          yield* get(sessionID)
          const inputID = input.id ?? SessionMessage.ID.create()
          const admittedInput = {
            type: "synthetic",
            payload: SessionInbox.SyntheticPayload.make({
              text: input.text,
              description: input.description,
              metadata: input.metadata,
            }),
            delivery: SessionInbox.Delivery.make(input.delivery ?? "steer"),
          } satisfies SessionInbox.Item
          const admitted = yield* SessionInbox.admit(db, bus, {
            id: inputID,
            sessionID,
            item: admittedInput,
          }).pipe(
            Effect.catchTag("SessionInbox.LifecycleConflict", () => new SyntheticConflictError({ sessionID, inputID })),
          )
          if (input.resume !== false && !(yield* get(sessionID)).revert) yield* execution.wake(sessionID)
          return admitted
        }),
      ),
  )
  const interrupt = Effect.fn("Session.interrupt")(
    (sessionID: SessionSchema.ID, options?: { readonly continue?: boolean }) =>
      Effect.uninterruptible(execution.interrupt(sessionID, options)),
  )
  const stage = Effect.fn("Session.revert.stage")(function* (
    sessionID: SessionSchema.ID,
    input: { messageID: SessionMessage.ID; files?: boolean },
  ) {
    const session = yield* get(sessionID)
    if ((yield* execution.active).has(sessionID)) return yield* new BusyError({ sessionID })
    return yield* SessionRevert.Service.use((revert) =>
      revert.stage({ session, messageID: input.messageID, files: input.files }),
    ).pipe(Effect.provide(servicesFor(session.location)))
  })
  const clear = Effect.fn("Session.revert.clear")(function* (sessionID: SessionSchema.ID) {
    const session = yield* get(sessionID)
    if ((yield* execution.active).has(sessionID)) return yield* new BusyError({ sessionID })
    yield* SessionRevert.Service.use((revert) => revert.clear(session)).pipe(
      Effect.provide(servicesFor(session.location)),
    )
    return yield* execution.wake(sessionID)
  })
  const commit = Effect.fn("Session.revert.commit")(function* (sessionID: SessionSchema.ID) {
    const session = yield* get(sessionID)
    if ((yield* execution.active).has(sessionID)) return yield* new BusyError({ sessionID })
    return yield* SessionRevert.commit(bus, session)
  })
  const revert = { stage, clear, commit }
  const operations = {
    get,
    inbox,
    prompt,
    synthetic,
    shell,
    compact,
    wait,
    resume,
    interrupt,
    cancelInbox,
    steerInbox,
    queueInbox,
    revert,
  }

  const forSession = (sessionID: SessionSchema.ID) => {
    const get = operations.get.bind(undefined, sessionID)
    const inbox = operations.inbox.bind(undefined, sessionID)
    const prompt = operations.prompt.bind(undefined, sessionID)
    const synthetic = operations.synthetic.bind(undefined, sessionID)
    const shell = operations.shell.bind(undefined, sessionID)
    const compact = operations.compact.bind(undefined, sessionID)
    const wait = operations.wait.bind(undefined, sessionID)
    const resume = operations.resume.bind(undefined, sessionID)
    const interrupt = operations.interrupt.bind(undefined, sessionID)
    const cancelInbox = operations.cancelInbox.bind(undefined, sessionID)
    const steerInbox = operations.steerInbox.bind(undefined, sessionID)
    const queueInbox = operations.queueInbox.bind(undefined, sessionID)
    const stage = operations.revert.stage.bind(undefined, sessionID)
    const clear = operations.revert.clear.bind(undefined, sessionID)
    const commit = operations.revert.commit.bind(undefined, sessionID)
    const revert = { stage, clear, commit }

    return {
      id: sessionID,
      get,
      inbox,
      prompt,
      synthetic,
      shell,
      compact,
      wait,
      resume,
      interrupt,
      cancelInbox,
      steerInbox,
      queueInbox,
      revert,
    }
  }
  const preparePrompt = Effect.fn("Session.preparePrompt")(function* (
    request: PromptRequest & { sessionID: SessionSchema.ID },
    messageID: SessionMessage.ID,
  ) {
    const plugins = yield* PluginSupervisor.Service
    yield* plugins.flush
    const hooks = yield* PluginHooks.Service
    const event = yield* hooks.trigger("session", "prompt", {
      sessionID: request.sessionID,
      messageID,
      prompt: structuredClone({
        text: request.text,
        files: request.files?.slice(),
        agents: request.agents?.slice(),
        skills: request.skills?.slice(),
      }),
      metadata: structuredClone(request.metadata),
      delivery: request.delivery ?? "steer",
    })
    const input = event.prompt
    const files = input.files
      ? yield* Effect.forEach(input.files, (file) => materializeAttachment(fs, file), { concurrency: 8 })
      : undefined
    const requested = input.skills
    const selected = yield* Effect.gen(function* () {
      if (!requested?.length) return undefined
      const skillService = yield* Skill.Service
      const prepared = new Map<Skill.ID, Skill.Name>()
      return yield* Effect.forEach(requested, (attachment) =>
        Effect.gen(function* () {
          const name = prepared.get(attachment.id)
          if (name !== undefined) return { id: attachment.id, name, mention: attachment.mention }
          const skill = yield* skillService.get(attachment.id)
          if (!skill) return yield* new SkillNotFoundError({ skill: attachment.id })
          prepared.set(skill.id, skill.name)
          return {
            id: skill.id,
            name: skill.name,
            text: (yield* Skill.prepare(fs, skill).pipe(Effect.orDie)).output,
            mention: attachment.mention,
          }
        }),
      )
    })
    return {
      type: "user",
      payload: SessionInbox.UserPayload.make({
        ...Prompt.make({
          text: input.text,
          agents: input.agents,
          files,
          skills: selected?.length ? selected : undefined,
        }),
        metadata: event.metadata,
      }),
      delivery: SessionInbox.Delivery.make(event.delivery),
    } satisfies SessionInbox.Item
  })

  return { forSession }
})

export type Handle = ReturnType<Effect.Success<ReturnType<typeof make>>["forSession"]>

function missingShellOutput() {
  const output = "Shell command output is no longer available."
  return {
    output,
    cursor: Buffer.byteLength(output),
    size: Buffer.byteLength(output),
    truncated: false,
  }
}

function synthesizeTerminalShellInfo(started: Info): Info {
  return {
    ...started,
    // The Shell record was removed before waiters could observe it; publish a terminal
    // boundary instead of leaving the Session shell message permanently running.
    status: "killed",
    time: { ...started.time, completed: Date.now() },
  }
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const materializeAttachment = Effect.fn("Session.materializeAttachment")(function* (
  fs: FSUtil.Interface,
  input: PromptInput.FileAttachment,
) {
  const resolved = input.uri.startsWith("data:")
    ? {
        bytes: yield* decodeDataURL(input.uri),
        source: { type: "inline" as const },
        start: undefined,
        end: undefined,
        name: undefined,
        mime: undefined,
      }
    : yield* readFileAttachment(fs, input.uri)
  if (resolved.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    return yield* new AttachmentError({
      uri: input.uri,
      message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${input.uri}`,
    })

  const mime = resolved.mime ?? Mime.detect(resolved.bytes)
  const content =
    mime === "text/plain" && resolved.start !== undefined
      ? Buffer.from(
          Buffer.from(resolved.bytes)
            .toString("utf8")
            .split("\n")
            .slice(resolved.start - 1, resolved.end)
            .join("\n"),
        )
      : resolved.bytes
  const normalized = yield* normalizeImageAttachment(input, Buffer.from(content).toString("base64"), mime)
  return FileAttachment.create({
    data: normalized.data,
    mime: normalized.mime,
    source: resolved.source,
    name: input.name ?? resolved.name,
    description: input.description,
    mention: input.mention,
  })
})

const normalizeImageAttachment = Effect.fn("Session.normalizeImageAttachment")(function* (
  input: PromptInput.FileAttachment,
  data: string,
  mime: string,
) {
  if (!mime.startsWith("image/")) return { data: Base64.make(data), mime }
  const service = yield* Image.Service
  const label = input.name ?? (input.uri.startsWith("data:") ? "inline attachment" : input.uri)
  const content = { uri: label, content: data, encoding: "base64" as const, mime }
  const normalized = yield* service.normalize(label, content).pipe(
    Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)),
    Effect.mapError((error) => new AttachmentError({ uri: label, message: error.message })),
  )
  return { data: Base64.make(normalized.content), mime: normalized.mime }
})

const readFileAttachment = Effect.fn("Session.readFileAttachment")(function* (fs: FSUtil.Interface, uri: string) {
  const url = yield* Effect.try({
    try: () => new URL(uri),
    catch: () => new AttachmentError({ uri, message: `Invalid attachment URI: ${uri}` }),
  })
  if (url.protocol !== "file:")
    return yield* new AttachmentError({ uri, message: `Unsupported attachment URI: ${uri}` })
  const start = positiveInt(url.searchParams.get("start"))
  const end = positiveInt(url.searchParams.get("end"))
  const target = yield* Effect.try({
    try: () => {
      url.search = ""
      url.hash = ""
      return fileURLToPath(url)
    },
    catch: () => new AttachmentError({ uri, message: `Invalid file URI: ${uri}` }),
  })
  const info = yield* fs
    .stat(target)
    .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
  if (info.type === "Directory") {
    const entries = yield* fs
      .readDirectoryEntries(target)
      .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
    return {
      bytes: Buffer.from(
        entries
          .filter((entry) => entry.type === "file" || entry.type === "directory")
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))
          .map((entry) => entry.name + (entry.type === "directory" ? path.sep : ""))
          .join("\n"),
      ),
      source: { type: "uri" as const, uri },
      start: undefined,
      end: undefined,
      name: path.basename(target),
      mime: "application/x-directory",
    }
  }
  if (info.type !== "File") return yield* new AttachmentError({ uri, message: `Attachment is not a file: ${uri}` })
  if (Number(info.size) > MAX_ATTACHMENT_BYTES)
    return yield* new AttachmentError({
      uri,
      message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${uri}`,
    })
  const bytes = yield* fs
    .readFile(target)
    .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
  return { bytes, source: { type: "uri" as const, uri }, start, end, name: path.basename(target), mime: undefined }
})

function decodeDataURL(uri: string) {
  return Effect.try({
    try: () => {
      const comma = uri.indexOf(",")
      if (comma === -1) throw new Error("Invalid data URL")
      const metadata = uri.slice(5, comma)
      const payload = uri.slice(comma + 1)
      if (!metadata.split(";").some((part) => part.toLowerCase() === "base64"))
        return Buffer.from(decodeURIComponent(payload))
      const bytes = Buffer.from(payload, "base64")
      if (bytes.toString("base64") !== payload) throw new Error("Non-canonical base64")
      return bytes
    },
    catch: () => new AttachmentError({ uri, message: "Invalid attachment data URL" }),
  })
}

function positiveInt(value: string | null) {
  if (value === null) return
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

// Mirrors the shell tool's in-memory preview safety limit.
const SHELL_MAX_CAPTURE_BYTES = 1024 * 1024
