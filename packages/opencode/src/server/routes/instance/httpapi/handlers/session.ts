import * as InstanceState from "@/effect/instance-state"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Instance } from "@/project/instance"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"

const log = Log.create({ service: "server" })

const mapNotFound = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catchIf(NotFoundError.isInstance, () => Effect.fail(new HttpApiError.NotFound({}))),
    Effect.catchDefect((error) =>
      NotFoundError.isInstance(error) ? Effect.fail(new HttpApiError.NotFound({})) : Effect.die(error),
    ),
  )

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const instance = yield* InstanceState.context
      return Instance.restore(instance, () =>
        Array.from(
          Session.list({
            directory: ctx.query.directory,
            scope: ctx.query.scope,
            path: ctx.query.path,
            roots: ctx.query.roots,
            start: ctx.query.start,
            search: ctx.query.search,
            limit: ctx.query.limit,
          }),
        ),
      )
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* mapNotFound(session.get(ctx.params.sessionID))
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      return yield* mapNotFound(
        Effect.gen(function* () {
          if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
          if (ctx.query.before) {
            const before = ctx.query.before
            yield* Effect.try({
              try: () => MessageV2.cursor.decode(before),
              catch: () => new HttpApiError.BadRequest({}),
            })
          }
          if (ctx.query.limit === undefined || ctx.query.limit === 0) {
            yield* session.get(ctx.params.sessionID)
            return yield* session.messages({ sessionID: ctx.params.sessionID })
          }

          yield* session.get(ctx.params.sessionID)
          const page = MessageV2.page({
            sessionID: ctx.params.sessionID,
            limit: ctx.query.limit,
            before: ctx.query.before,
          })
          if (!page.cursor) return page.items

          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          url.searchParams.set("limit", ctx.query.limit.toString())
          url.searchParams.set("before", page.cursor)
          return HttpServerResponse.jsonUnsafe(page.items, {
            headers: {
              "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
              Link: `<${url.toString()}>; rel="next"`,
              "X-Next-Cursor": page.cursor,
            },
          })
        }),
      )
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* mapNotFound(
        Effect.sync(() => MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID })),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionShare.Service.use((svc) => svc.create(ctx.payload)).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new HttpApiError.BadRequest({}),
      })
      const payload = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.remove(ctx.params.sessionID)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) =>
              Effect.gen(function* () {
                const current = yield* svc.get(ctx.params.sessionID)
                if (ctx.payload.title !== undefined) {
                  yield* svc.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
                }
                if (ctx.payload.permission !== undefined) {
                  yield* svc.setPermission({
                    sessionID: ctx.params.sessionID,
                    permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
                  })
                }
                if (ctx.payload.time?.archived !== undefined) {
                  yield* svc.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
                }
                return yield* svc.get(ctx.params.sessionID)
              }),
            ).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ForkPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) =>
              svc.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload.messageID }),
            ).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) => svc.cancel(ctx.params.sessionID)).pipe(
              Effect.provide(SessionPrompt.defaultLayer),
            ),
          ),
        ),
      )
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.command({
                sessionID: ctx.params.sessionID,
                messageID: ctx.payload.messageID,
                model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
                command: Command.Default.INIT,
                arguments: "",
              }),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const share = yield* SessionShare.Service
              const session = yield* Session.Service
              yield* share.share(ctx.params.sessionID)
              return yield* session.get(ctx.params.sessionID)
            }).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const share = yield* SessionShare.Service
              const session = yield* Session.Service
              yield* share.unshare(ctx.params.sessionID)
              return yield* session.get(ctx.params.sessionID)
            }).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const session = yield* Session.Service
              const revert = yield* SessionRevert.Service
              const compact = yield* SessionCompaction.Service
              const prompt = yield* SessionPrompt.Service
              const agent = yield* Agent.Service

              yield* revert.cleanup(yield* session.get(ctx.params.sessionID))
              const messages = yield* session.messages({ sessionID: ctx.params.sessionID })
              const defaultAgent = yield* agent.defaultAgent()
              const currentAgent =
                messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

              yield* compact.create({
                sessionID: ctx.params.sessionID,
                agent: currentAgent,
                model: {
                  providerID: ctx.payload.providerID,
                  modelID: ctx.payload.modelID,
                },
                auto: ctx.payload.auto ?? false,
              })
              yield* prompt.loop({ sessionID: ctx.params.sessionID })
            }).pipe(
              Effect.provide(SessionRevert.defaultLayer),
              Effect.provide(SessionCompaction.defaultLayer),
              Effect.provide(SessionPrompt.defaultLayer),
              Effect.provide(Agent.defaultLayer),
              Effect.provide(Session.defaultLayer),
            ),
          ),
        ),
      )
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return HttpServerResponse.stream(
        Stream.fromEffect(
          Effect.promise(() =>
            Instance.restore(instance, () =>
              AppRuntime.runPromise(
                SessionPrompt.Service.use((svc) =>
                  svc.prompt({
                    ...ctx.payload,
                    sessionID: ctx.params.sessionID,
                  } as unknown as SessionPrompt.PromptInput),
                ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
              ),
            ),
          ),
        ).pipe(
          Stream.map((message) => JSON.stringify(message)),
          Stream.encodeText,
        ),
        { contentType: "application/json" },
      )
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.sync(() => {
        Instance.restore(instance, () => {
          void AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID } as unknown as SessionPrompt.PromptInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ).catch((error) => {
            log.error("prompt_async failed", { sessionID: ctx.params.sessionID, error })
            void Bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({
                message: error instanceof Error ? error.message : String(error),
              }).toObject(),
            })
          })
        })
      })
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.command({ ...ctx.payload, sessionID: ctx.params.sessionID } as SessionPrompt.CommandInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID } as SessionPrompt.ShellInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      const instance = yield* InstanceState.context
      log.info("revert", ctx.payload)
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionRevert.Service.use((svc) => svc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload })).pipe(
              Effect.provide(SessionRevert.defaultLayer),
            ),
          ),
        ),
      )
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionRevert.Service.use((svc) => svc.unrevert({ sessionID: ctx.params.sessionID })).pipe(
              Effect.provide(SessionRevert.defaultLayer),
            ),
          ),
        ),
      )
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Permission.Service.use((svc) =>
              svc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }),
            ).pipe(Effect.provide(Permission.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const state = yield* SessionRunState.Service
              const session = yield* Session.Service
              yield* state.assertNotBusy(ctx.params.sessionID)
              yield* session.removeMessage(ctx.params)
            }).pipe(Effect.provide(SessionRunState.defaultLayer), Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.removePart(ctx.params)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        throw new Error(
          `Part mismatch: body.id='${payload.id}' vs partID='${ctx.params.partID}', body.messageID='${payload.messageID}' vs messageID='${ctx.params.messageID}', body.sessionID='${payload.sessionID}' vs sessionID='${ctx.params.sessionID}'`,
        )
      }
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.updatePart(payload)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handle("fork", fork)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
