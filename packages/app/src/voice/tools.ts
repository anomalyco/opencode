import type { SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ServerCtx } from "@/runtime/server/runtime"
import { decodeArguments, type ToolCall } from "./protocol"
import { ReplyWatch } from "./replies"
import { messageExcerpts } from "./messages"
import { formatHandoff, headerLapse } from "./handoff"
import { folder, matchModels, SessionSearch } from "./search"

type Request = { id: string; sessionID: string; transcript: string[] }

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
    },
  ) {}

  run(call: ToolCall, request: Request, signal: AbortSignal) {
    const existing = this.calls.get(call.call_id)

    if (existing) return existing

    const result = this.execute(call, request, signal)
      .then(JSON.stringify)
      .catch(() =>
        JSON.stringify({ error: "Tool request failed. Do not claim it succeeded or resend an uncertain admission." }),
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

  private async execute(call: ToolCall, request: Request, signal: AbortSignal) {
    signal.throwIfAborted()
    const args = decodeArguments(call.arguments)
    const api = this.ctx.sdk.api
    const sessionID = args.session_id ?? request.sessionID
    const options = { signal }

    const row = (session: SessionInfo) => ({
      id: session.id,
      title: session.title ?? session.id,
      project: folder(session.location.directory),
      on_screen: session.id === request.sessionID,
    })

    if (call.name === "list_sessions") {
      const sessions = await api.session.list({ limit: args.limit ?? 15, parentID: null, archived: false }, options)

      return sessions.data.map(row)
    }

    if (call.name === "search_sessions") {
      if (!args.query?.trim()) throw new Error("query required")
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

    if (call.name === "create_session") {
      const directory = args.directory

      if (!directory) throw new Error("directory required")
      const projects = await api.project.list({ archived: false }, options)

      if (!projects.some((project) => project.canonical === directory || project.sandboxes.includes(directory)))
        return { error: "Directory is not a known project or worktree on this server. No session was created." }

      const source = await api.session.get({ sessionID: request.sessionID }, options)
      signal.throwIfAborted()

      const created = this.ctx.data.session.create({
        location: { directory },
        title: args.title,
        model: source.model,
        agent: source.agent,
      })

      await created.request

      return { session_id: created.id }
    }

    if (call.name === "open_session") {
      if (!args.session_id) throw new Error("session_id required")
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
      await api.session.interrupt({ sessionID }, options)

      return { interrupted: sessionID }
    }

    if (call.name === "send_message") {
      if (!args.text?.trim()) throw new Error("text required")
      const session = await api.session.get({ sessionID }, options)
      signal.throwIfAborted()
      const id = SessionMessage.ID.create()
      const delivery = args.delivery ?? "steer"
      const prompt = { sessionID, promptID: id, title: session.title ?? session.id, instruction: args.text }
      const explained = this.explained.get(sessionID)
      const full = explained === undefined || Date.now() - explained > headerLapse

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

      const admission = {
        sessionID,
        id,
        delivery,
        text: formatHandoff({
          instruction: args.text,
          transcript: request.transcript,
          context: `Session ${JSON.stringify(prompt.title)} in project ${JSON.stringify(folder(session.location.directory))}.`,
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

    if (call.name === "list_models") {
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

      if (!wanted) throw new Error("model required")
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

    if (call.name === "read_session" || call.name === "wait_for_session") {
      if (call.name === "wait_for_session") {
        await api.experimental.session.wait({ sessionID }, { signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) })
      }

      const [session, messages] = await Promise.all([
        api.session.get({ sessionID }, options),
        api.message.list(
          { sessionID, limit: args.limit ?? 20, order: args.cursor ? undefined : "desc", cursor: args.cursor },
          options,
        ),
      ])

      const observed = this.observed.get(request.id) ?? new Map<string, string[]>()
      observed.set(sessionID, [
        ...(observed.get(sessionID) ?? []),
        ...messages.data
          .filter((message) => message.type === "assistant" && message.time.completed)
          .map((message) => message.id),
      ])
      this.observed.set(request.id, observed)

      return {
        session: { id: session.id, title: session.title, outcome: session.outcome, time: session.time },
        messages: { data: messageExcerpts(messages.data), cursor: messages.cursor },
      }
    }

    throw new Error("Unknown voice tool")
  }
}
