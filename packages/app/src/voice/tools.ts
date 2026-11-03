import type { FormInfo, PermissionRequest, SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ServerCtx } from "@/runtime/server/runtime"
import { decodeArguments, type ToolCall } from "./protocol"
import { ReplyWatch } from "./replies"
import { latestReply, messagePage, messageText, readLines } from "./messages"
import { formatHandoff, headerLapse } from "./handoff"
import { folder, matchModels, SessionSearch } from "./search"
import { userSpoke } from "./spec"

/**
 * One request from the voice agent: the session on screen when it was asked, its share of the conversation, the user's
 * turn when it was made, and the sessions its messages reached.
 */
type Request = { id: string; sessionID?: string; transcript: string[]; turn?: number; sent?: string[] }

type Pending = { permissions: PermissionRequest[]; forms: FormInfo[] }

const held =
  "This session is waiting on the request and would hold anything sent until it's resolved. A message never answers it. When the user approved, picked, or answered, that is the answer: answer_question with their option values, or reply_permission. If they answered only some of a question's fields, ask about the rest before answering. A request for more or other work isn't an answer: dismiss_question with a note in their words. A permission they want something else instead of: reply_permission reject with a note in their words. Otherwise ask them. Then send again."

function described(session: SessionInfo, pending: Pending) {
  return {
    session: session.title ?? session.id,
    permissions: pending.permissions.map((request) => ({
      request_id: request.id,
      action: request.action,
      resources: request.resources,
      message: request.message,
    })),
    questions: pending.forms.map((form) => ({ form_id: form.id, title: form.title, fields: form.fields })),
  }
}

/** A tool's own refusal, told to the delegator as it is, as on iOS; anything else is a failed request. */
class ToolError extends Error {}

/** A tool that needs a session ran while the call was on a draft whose session couldn't be created. */
class NoSession extends ToolError {
  constructor() {
    super("There's no session yet: the call's new session couldn't be created. Create one with create_session first.")
  }
}

export class VoiceTools {
  readonly replies = new ReplyWatch()
  private calls = new Map<string, Promise<string>>()
  private observed = new Map<string, Map<string, string[]>>()
  /** When each session last received a delegation's full header in this call. */
  private explained = new Map<string, number>()

  constructor(
    private readonly ctx: ServerCtx,
    private readonly screen: {
      /** Shows the session on Desktop's screen; resolves only once the screen shows it. */
      open: (session: SessionInfo, signal: AbortSignal) => Promise<void>
      /** Session IDs with an open tab. */
      tabs: () => string[]
      /** While the call is on a new-session draft, the session the call creates for it. */
      draft?: () => Promise<SessionInfo | undefined> | undefined
      /** Resolves when the user next says something. */
      spoke?: (signal: AbortSignal) => Promise<void>
    },
  ) {}

  run(call: ToolCall, request: Request, signal: AbortSignal) {
    const existing = this.calls.get(call.call_id)

    if (existing) return existing

    const result = this.execute(call, request, signal)
      .then(JSON.stringify)
      .catch((error) =>
        JSON.stringify({
          error:
            error instanceof ToolError
              ? error.message
              : "Tool request failed. Do not claim it succeeded or resend an uncertain admission.",
        }),
      )

    this.calls.set(call.call_id, result)

    return result
  }

  answered(id: string) {
    this.observed.get(id)?.forEach((messages, sessionID) => this.replies.heard(sessionID, messages))
    this.observed.delete(id)
  }

  async history(sessionID: string, signal: AbortSignal) {
    const messages: SessionMessageInfo[] = []

    const page = async (cursor?: string): Promise<SessionMessageInfo[]> => {
      const result = await this.ctx.sdk.api.message.list(
        { sessionID, order: cursor ? undefined : "desc", limit: 100, cursor },
        { signal },
      )

      messages.unshift(...result.data.toReversed())

      if (this.replies.pending(sessionID).every((id) => messages.some((message) => message.id === id))) return messages

      if (result.data.length && result.cursor.next) return page(result.cursor.next)

      return messages
    }

    return page()
  }

  /** Pending permission requests and questions in a session and its subagents. */
  async requests(session: SessionInfo, signal: AbortSignal) {
    const api = this.ctx.sdk.api
    const location = { directory: session.location.directory }

    const [permissions, forms] = await Promise.all([
      api.permission.request.list({ location }, { signal }),
      api.form.list({ location }, { signal }),
    ])

    const family = new Map([[session.id, Promise.resolve(true)]])

    const within = (sessionID: string): Promise<boolean> => {
      const known = family.get(sessionID)

      if (known) return known

      const found = api.session.get({ sessionID }, { signal }).then(
        (child) => (child.parentID ? within(child.parentID) : false),
        () => false,
      )

      family.set(sessionID, found)

      return found
    }

    const kept = async <T extends { sessionID: string }>(items: T[]) => {
      const inside = await Promise.all(items.map((item) => within(item.sessionID)))

      return items.filter((_, index) => inside[index])
    }

    return { permissions: await kept(permissions.data), forms: await kept(forms.data) }
  }

  private async execute(call: ToolCall, request: Request, signal: AbortSignal) {
    signal.throwIfAborted()
    const args = decodeArguments(call.arguments)
    const api = this.ctx.sdk.api

    // The session a tool acts on: the one it names, else the one on screen, else, on a draft, the session the call
    // is creating for it, which later tools in the request then default to.
    const target = async () => {
      const id = args.session_id ?? request.sessionID ?? (await this.screen.draft?.())?.id

      if (!id) throw new NoSession()
      request.sessionID ??= id

      return id
    }

    const options = { signal }

    const row = (session: SessionInfo) => ({
      id: session.id,
      title: session.title ?? session.id,
      project: folder(session.location.directory),
      on_screen: session.id === request.sessionID,
    })

    if (call.name === "list_sessions") {
      const [sessions, active] = await Promise.all([
        api.session.list({ limit: args.limit ?? 15, parentID: null, archived: false }, options),
        api.session.active(options),
      ])

      const waiting = await this.waiting(sessions.data, signal)

      return sessions.data.map((session) => ({
        ...row(session),
        working: session.id in active,
        needs_input: waiting ? waiting.has(session.id) : "unknown",
        outcome: session.outcome,
      }))
    }

    if (call.name === "list_projects") {
      const projects = await api.project.list({ archived: false }, options)

      return projects
        .flatMap((project) => [project.canonical, ...project.sandboxes])
        .slice(0, 20)
        .map((directory) => ({ name: folder(directory), directory }))
    }

    if (call.name === "end_call") return { ending: "after your reply is spoken; make it a short goodbye" }

    if (call.name === "list_requests") {
      const session = await api.session.get({ sessionID: await target() }, options)

      return described(session, await this.requests(session, signal))
    }

    if (call.name === "reply_permission") {
      if (!args.request_id || !args.decision) throw new ToolError("request_id and decision are required.")
      const session = await api.session.get({ sessionID: await target() }, options)
      const request = (await this.requests(session, signal)).permissions.find((item) => item.id === args.request_id)

      if (!request)
        return { error: "No pending permission request with that ID. Call list_requests; nothing was answered." }
      await api.permission.reply(
        {
          sessionID: request.sessionID,
          requestID: request.id,
          decision: args.decision,
          message: args.decision === "reject" ? args.note : undefined,
        },
        options,
      )

      return { replied: args.decision, session: session.title ?? session.id }
    }

    if (call.name === "answer_question" || call.name === "dismiss_question") {
      if (!args.form_id) throw new ToolError("form_id is required.")
      const session = await api.session.get({ sessionID: await target() }, options)
      const form = (await this.requests(session, signal)).forms.find((item) => item.id === args.form_id)

      if (!form) return { error: "No pending question with that ID. Call list_requests; nothing was answered." }

      if (call.name === "dismiss_question") {
        await api.session.form.cancel({ sessionID: form.sessionID, formID: form.id, message: args.note }, options)

        return { dismissed: true, session: session.title ?? session.id }
      }

      if (!args.answers || !Object.keys(args.answers).length)
        throw new ToolError("answers must map each field key to its value.")
      await api.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer: args.answers }, options)

      return { answered: form.id, session: session.title ?? session.id }
    }

    if (call.name === "search_sessions") {
      if (!args.query?.trim()) throw new ToolError("query is required.")
      const search = new SessionSearch(args.query)
      const query = args.query

      // Subagents stay searchable, but a separate top-level search keeps a page of matching subagents from
      // crowding out root sessions, and only root matches decide whether to retry with the longest word.
      const lookup = async (text: string) => {
        const [roots, all] = await Promise.all([
          api.session.list({ search: text, limit: 20, parentID: null, archived: false }, options),
          api.session.list({ search: text, limit: 20, archived: false }, options),
        ])

        return { roots: roots.data, all: [...roots.data, ...all.data] }
      }

      const remote = async () => {
        const found = await lookup(query)
        const term = search.longestTerm

        if (found.roots.length || !term || term === search.phrase) return found.all

        return [...found.all, ...(await lookup(term)).all]
      }

      const [recent, found] = await Promise.all([
        api.session.list({ limit: 100, parentID: null, archived: false }, options),
        remote(),
      ])

      const seen = new Set<string>()
      const tabs = new Set(this.screen.tabs())

      // Best match first; among equal matches, top-level sessions with an open tab, then the most recent.
      const rank = (session: SessionInfo) =>
        (search.score(session) ?? 0) * 4 + (session.parentID ? 0 : 2) + (tabs.has(session.id) ? 1 : 0)

      return [...recent.data.filter((session) => search.score(session) !== undefined), ...found]
        .filter((session) => !seen.has(session.id) && !!seen.add(session.id))
        .toSorted((a, b) => rank(b) - rank(a) || b.time.updated - a.time.updated)
        .slice(0, Math.min(args.limit ?? 8, 20))
        .map((session) => ({ ...row(session), open_tab: tabs.has(session.id) }))
    }

    // As on iOS, a new session opens on screen, taking the draft's session when it's for the same project, and can
    // carry its first message.
    if (call.name === "create_session") {
      const directory = args.directory

      if (!directory) throw new ToolError("directory is required: an absolute project folder from list_projects.")
      const projects = await api.project.list({ archived: false }, options)

      if (!projects.some((project) => project.canonical === directory || project.sandboxes.includes(directory)))
        return {
          error:
            "Directory is not a known project or worktree on this server; pass one from list_projects. No session was created.",
        }

      const draft = await this.screen.draft?.()
      const source = request.sessionID ? await api.session.get({ sessionID: request.sessionID }, options) : undefined
      signal.throwIfAborted()

      const session =
        draft?.location.directory === directory
          ? draft
          : await (async () => {
              const created = this.ctx.data.session.create({
                location: { directory },
                model: source?.model,
                agent: source?.agent,
              })

              await created.request

              return api.session.get({ sessionID: created.id }, options)
            })()

      await this.screen.open(session, signal).catch(() => undefined)
      request.sessionID = session.id
      const sent = args.text?.trim() ? await this.send(session, args.text, "steer", request, signal) : undefined

      return {
        created: session.title ?? "New session",
        session_id: session.id,
        project: folder(directory),
        ...(sent && { sent }),
      }
    }

    if (call.name === "open_session") {
      if (!args.session_id) throw new ToolError("session_id is required.")
      const session = await api.session.get({ sessionID: args.session_id }, options).catch(() => undefined)

      if (!session) return { error: "No session with that ID on this server. The screen did not move." }

      if (session.time.archived) return { error: "That session is archived. The screen did not move." }
      signal.throwIfAborted()

      const shown = await this.screen.open(session, signal).then(
        () => true,
        () => false,
      )

      if (!shown) return { error: "Desktop did not show that session. The screen did not move." }

      // Later tools in this request default to the session now on screen.
      request.sessionID = session.id

      return { opened: session.title ?? session.id }
    }

    if (call.name === "interrupt_session") {
      const sessionID = await target()
      await api.session.interrupt({ sessionID }, options)

      return { interrupted: sessionID }
    }

    if (call.name === "send_message") {
      if (!args.text?.trim()) throw new ToolError("text is required.")
      const session = await api.session.get({ sessionID: await target() }, options)
      signal.throwIfAborted()

      return this.send(session, args.text, args.delivery ?? "steer", request, signal)
    }

    if (call.name === "list_models") {
      const sessionID = await target()
      const session = await api.session.get({ sessionID }, options)
      const catalog = await api.model.list({ location: { directory: session.location.directory } }, options)
      const current = session.model

      const models = matchModels(
        catalog.data.filter((model) => model.enabled),
        args.query,
      )

      return {
        session: session.title ?? session.id,
        matches: models.length,
        models: models.slice(0, Math.min(args.limit ?? 20, 50)).map((model) => {
          const selected = current?.providerID === model.providerID && current.id === model.id

          return {
            id: `${model.providerID}/${model.id}`,
            name: model.name,
            provider: model.providerID,
            variants: model.variants.map((variant) => variant.id),
            current: selected,
            current_variant: selected ? current?.variant : undefined,
          }
        }),
      }
    }

    if (call.name === "switch_model") {
      const wanted = args.model?.trim()

      if (!wanted) throw new ToolError("model is required: an id from list_models.")
      const sessionID = await target()
      const session = await api.session.get({ sessionID }, options)
      const catalog = await api.model.list({ location: { directory: session.location.directory } }, options)
      const enabled = catalog.data.filter((item) => item.enabled)

      const model =
        enabled.find((item) => `${item.providerID}/${item.id}` === wanted) ??
        enabled.find((item) => `${item.providerID}/${item.id}`.toLowerCase() === wanted.toLowerCase())

      if (!model) return { error: `No model ${wanted}; pass an id from list_models. The model did not change.` }
      const offered = model.variants.map((variant) => variant.id)

      if (args.variant && !offered.includes(args.variant))
        return {
          error: offered.length
            ? `${model.name} has no ${args.variant} variant; it offers ${offered.join(", ")}. The model did not change.`
            : `${model.name} has no variants; omit variant. The model did not change.`,
        }

      // Keep the reasoning variant when the new model offers it too, as the picker does.
      const variant =
        args.variant ??
        (session.model?.variant && offered.includes(session.model.variant) ? session.model.variant : undefined)

      await api.session.switchModel(
        { sessionID, model: { id: model.id, providerID: model.providerID, variant } },
        options,
      )

      return { switched_to: model.name, variant: variant ?? "default", session: session.title ?? session.id }
    }

    if (call.name === "read_session") {
      const session = await api.session.get({ sessionID: await target() }, options)
      const title = session.title ?? session.id

      // One message whole, by the ID a cut one named, paged past 12,000 characters.
      if (args.message_id) {
        const message = await api.session.message
          .get({ sessionID: session.id, messageID: args.message_id }, options)
          .catch(() => undefined)

        const text = message && messageText(message)

        if (!message || !text)
          throw new ToolError(`No text in message ${args.message_id} of "${title}"; pass a message_id from a read.`)
        const offset = args.offset ?? 0

        return {
          title,
          message_id: message.id,
          role: message.type,
          total_characters: text.length,
          offset,
          text: messagePage(text, message.id, offset),
        }
      }

      // Idle first, then the transcript: a run ending in between still has its reply in it.
      const working = await api.session.active(options).then((active) => session.id in active)
      const messages = await this.recent(session.id, signal)

      // A reply read while the session is idle has been told; one still running hasn't finished.
      if (!working) this.observe(request.id, session.id, messages)

      return { title, working, messages: readLines(messages, args.limit ?? 8) }
    }

    // GPT-Live takes no new turn while a request is open, so the user speaking ends the wait, as on iOS: the answer
    // frees the voice agent for them, and the reply is spoken when it lands.
    if (call.name === "wait_for_session") {
      const session = await api.session.get({ sessionID: await target() }, options)
      const stop = new AbortController()
      const scope = AbortSignal.any([signal, stop.signal])

      const end = await Promise.race([
        api.experimental.session
          .wait({ sessionID: session.id }, { signal: AbortSignal.any([scope, AbortSignal.timeout(90_000)]) })
          .then(
            () => "idle" as const,
            () => "timeout" as const,
          ),
        (this.screen.spoke?.(scope) ?? new Promise<never>(() => undefined)).then(() => "spoke" as const),
      ]).finally(() => stop.abort())

      signal.throwIfAborted()

      if (end === "spoke") return { finished: false, user_spoke: userSpoke }
      const messages = await this.recent(session.id, signal)

      if (end === "idle") this.observe(request.id, session.id, messages)

      return {
        finished: end === "idle",
        latest_reply: latestReply(messages, this.replies.latest(session.id)) ?? latestReply(messages) ?? "",
      }
    }

    throw new ToolError(`Unknown tool ${call.name}.`)
  }

  // Sends work as a voice delegation, the way a typed message would, and watches for its reply.
  private async send(
    session: SessionInfo,
    text: string,
    delivery: "steer" | "queue",
    request: Request,
    signal: AbortSignal,
  ) {
    const api = this.ctx.sdk.api
    const options = { signal }
    const sessionID = session.id
    const id = SessionMessage.ID.create()
    const title = session.title ?? session.id
    const prompt = { sessionID, promptID: id, title, instruction: text, turn: request.turn }
    const explained = this.explained.get(sessionID)
    const full = explained === undefined || Date.now() - explained > headerLapse

    // A steer would wait behind a pending request, and never answers it, so the delegator gets the requests to
    // answer or dismiss first. Unreadable requests don't hold the message.
    if (delivery === "steer") {
      const pending = await this.requests(session, signal).catch(() => undefined)

      if (pending && (pending.permissions.length || pending.forms.length))
        return { ...described(session, pending), not_sent: true, note: held }
    }

    // Like a typed steer, move blocking shells and subagents to the background so the agent reads it next. Tried
    // once and briefly: the steer goes either way, and an idle session makes it a no-op.
    if (delivery === "steer")
      await api.session
        .background({ sessionID }, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) })
        .catch(() => undefined)
    signal.throwIfAborted()
    // Register before admission: a network failure may still have delivered
    // the prompt. Keep this ID's watch across a dropped call and Rejoin.
    this.replies.sent(prompt)
    request.sent = [...(request.sent ?? []), title]

    const admission = {
      sessionID,
      id,
      delivery,
      text: formatHandoff({
        instruction: text,
        transcript: request.transcript,
        context: `Session ${JSON.stringify(title)} in project ${JSON.stringify(folder(session.location.directory))}.`,
        full,
      }),
    }

    const result = await this.ctx.data.session.prompt(admission).then(
      () => ({ admitted: true }),
      async () => {
        const inbox = await api.session.inbox.list({ sessionID }, options)
        const history = await this.history(sessionID, signal)

        return { admitted: inbox.some((item) => item.id === id) || history.some((message) => message.id === id) }
      },
    )

    if (result.admitted && full) this.explained.set(sessionID, Date.now())

    return {
      ...prompt,
      ...result,
      status: result.admitted ? "Work admitted; its reply will be announced." : "Admission uncertain; do not resend.",
    }
  }

  // A session's last 40 messages, oldest first.
  private async recent(sessionID: string, signal: AbortSignal) {
    const page = await this.ctx.sdk.api.message.list({ sessionID, order: "desc", limit: 40 }, { signal })

    return page.data.toReversed()
  }

  // The replies a request read: once it's answered, they've been told and aren't announced again.
  private observe(id: string, sessionID: string, messages: readonly SessionMessageInfo[]) {
    const observed = this.observed.get(id) ?? new Map<string, string[]>()
    observed.set(sessionID, [
      ...(observed.get(sessionID) ?? []),
      ...messages.flatMap((message) => (message.type === "assistant" && message.time.completed ? [message.id] : [])),
    ])
    this.observed.set(id, observed)
  }

  // Which listed sessions wait on a permission or question, their subagents' included; undefined when it couldn't be
  // read.
  private async waiting(sessions: readonly SessionInfo[], signal: AbortSignal) {
    const api = this.ctx.sdk.api
    const listed = new Set(sessions.map((session) => session.id))
    const parents = new Map<string, Promise<string | undefined>>()

    // The listed session a request's session belongs to: itself, or the one its subagent chain leads to.
    const rootOf = (sessionID: string): Promise<string | undefined> => {
      if (listed.has(sessionID)) return Promise.resolve(sessionID)
      const known = parents.get(sessionID)

      if (known) return known

      const found = api.session.get({ sessionID }, { signal }).then(
        (session) => (session.parentID ? rootOf(session.parentID) : undefined),
        () => undefined,
      )

      parents.set(sessionID, found)

      return found
    }

    const directories = [...new Set(sessions.map((session) => session.location.directory))]

    const pending = await Promise.all(
      directories.map(async (directory) => {
        const [permissions, forms] = await Promise.all([
          api.permission.request.list({ location: { directory } }, { signal }),
          api.form.list({ location: { directory } }, { signal }),
        ])

        return [...permissions.data, ...forms.data]
      }),
    ).catch(() => undefined)

    if (!pending) return
    const roots = await Promise.all(pending.flat().map((item) => rootOf(item.sessionID)))

    return new Set(roots.filter((id): id is string => id !== undefined))
  }
}
