import {
  agent,
  methods,
  RequestError,
  ContentBlock,
  RequestPermissionOutcome,
  type CreateElicitationRequest as CreateElicitationRequestV2,
  type AgentConnection,
  type AgentRequestContext,
  type ForkSessionRequest,
  type AnyWireMessage,
  type JsonRpcId,
  type InitializeRequest as InitializeRequestV2,
  McpServer,
  type NewSessionRequest,
  type PromptRequest,
  type ResumeSessionRequest,
  type SetSessionConfigOptionRequest,
  type SessionConfigOption as SessionConfigOptionV2,
  type SessionUpdate as SessionUpdateV2,
  type ToolCallContent as ToolCallContentV2,
  type WireStream,
} from "@agentclientprotocol/sdk/experimental/v2"
import type {
  McpServer as McpServerV1,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent as ToolCallContentV1,
} from "@agentclientprotocol/sdk"
import { CreateElicitationRequest } from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode/client/effect"
import { createTwoFilesPatch } from "diff"
import { Cause, Deferred, Effect, Ref, type Scope } from "effect"
import { ACPCapabilities } from "./capabilities"
import { ACPCatalog } from "./catalog"
import { ACPClient } from "./client"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"
import { ACPService } from "./service"
import { ACPSessions } from "./sessions"
import { ACPTurn } from "./turn"
import { OPENCODE_VERSION } from "../version"

type Ready = {
  readonly service: ACPService.Interface
  readonly connection: ACPConnection.Interface
}

type HandlerContext<Params> = AgentRequestContext<Params>

export const connect = Effect.fnUntraced(function* (client: OpenCodeClient, stream: WireStream) {
  const scope = yield* Effect.scope
  const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>())
  const ready = yield* Deferred.make<Ready>()
  const app = agent({ name: "opencode" })
  const handle =
    <Params, A>(
      call: (service: ACPService.Interface, ctx: HandlerContext<Params>) => Effect.Effect<A, ACPError.Failure>,
    ) =>
    (ctx: HandlerContext<Params>) => {
      const effect = Effect.gen(function* () {
        const connected = yield* Deferred.await(ready)
        const operation = call(connected.service, ctx)
        return yield* ctx.requestId === undefined
          ? operation
          : operation.pipe(
              Effect.provideService(ACPConnection.Responded, connected.connection.responded(ctx.requestId)),
            )
      }).pipe(
        Effect.catchTags({
          ACPCatalogLoadError: (error) => ACPClient.classify(error.cause),
          ACPCatalogNotReadyError: (error) =>
            Effect.fail(new ACPError.ServiceFailureError({ safeMessage: error.message, errorName: "CatalogNotReady" })),
        }),
        Effect.mapError((error) => (error instanceof RequestError ? error : ACPError.toRequestError(error))),
        Effect.tapCauseIf(Cause.hasDies, (cause) => Effect.logError("ACP v2 request failed", cause)),
        Effect.catchDefect((defect) => Effect.fail(ACPError.toRequestError(ACPError.fromUnknown(defect)))),
      )
      return run(effect)
    }

  app.onRequest(
    "initialize",
    handle((service, ctx) => initialize(service, ctx.params)),
  )
  app.onRequest(
    "auth/login",
    handle((service, ctx) => service.authenticate(ctx.params)),
  )
  app.onRequest(
    "auth/logout",
    handle(() =>
      Effect.gen(function* () {
        const responded = yield* ACPConnection.Responded
        // Log out of this ACP connection, not the user's shared provider credentials.
        yield* responded.pipe(Effect.andThen(Effect.sync(() => connection.close())), Effect.forkIn(scope))
        return {}
      }),
    ),
  )
  app.onRequest(
    "session/fork",
    handle((service, ctx) => forkSession(service, ctx.params)),
  )
  app.onRequest(
    "session/new",
    handle((service, ctx) => newSession(service, ctx.params)),
  )
  app.onRequest(
    "session/list",
    handle((service, ctx) => service.listSessions(ctx.params)),
  )
  app.onRequest(
    "session/delete",
    handle((service, ctx) => service.deleteSession(ctx.params)),
  )
  app.onRequest(
    "session/resume",
    handle((service, ctx) => resumeSession(service, ctx.params)),
  )
  app.onRequest(
    "session/close",
    handle((service, ctx) => service.closeSession(ctx.params)),
  )
  app.onRequest(
    "session/set_config_option",
    handle((service, ctx) => setConfigOption(service, ctx.params)),
  )
  app.onRequest(
    "session/prompt",
    handle((service, ctx) => prompt(service, ctx.params, ctx.signal)),
  )
  app.onNotification("session/cancel", (ctx) =>
    run(Effect.flatMap(Deferred.await(ready), (connected) => connected.service.cancel(ctx.params))),
  )
  const responses = new Map<JsonRpcId, Deferred.Deferred<void>>()
  const writer = stream.writable.getWriter()
  const connection = app.connect({
    readable: stream.readable,
    writable: new WritableStream<AnyWireMessage>({
      async write(message) {
        await writer.write(message)
        const messages = Array.isArray(message) ? message : [message]
        for (const item of messages) {
          if ("method" in item) continue
          const responded = responses.get(item.id)
          if (!responded) continue
          responses.delete(item.id)
          Deferred.doneUnsafe(responded, "result" in item ? Effect.void : Effect.interrupt)
        }
      },
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => connection.close()))
  yield* setup(client, makeConnection(connection, responses), ready)
  return connection
})

const setup = Effect.fnUntraced(function* (
  client: OpenCodeClient,
  connection: ACPConnection.Interface,
  ready: Deferred.Deferred<Ready>,
) {
  const catalog = yield* ACPCatalog.make(client)
  const sessions = yield* ACPSessions.make({ client, connection, catalog })
  const capabilities = yield* Ref.make(ACPCapabilities.parse(undefined))
  const turn = yield* ACPTurn.make({ client, connection, sessions, catalog, capabilities })
  yield* Deferred.succeed(ready, {
    service: ACPService.make({ client, connection, catalog, sessions, capabilities, turn }),
    connection,
  })
})

function makeConnection(
  agentConnection: AgentConnection,
  responses: Map<JsonRpcId, Deferred.Deferred<void>>,
): ACPConnection.Interface {
  const states = new Map<string, SessionUpdateV2>()
  const promise = <A>(evaluate: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: evaluate, catch: (cause) => cause }).pipe(
      Effect.catch((cause) => (cause instanceof RequestError ? Effect.fail(cause) : Effect.die(cause))),
    )

  return {
    sessionSnapshot: (sessionID) =>
      promise(() =>
        agentConnection.client.notify(methods.client.session.update, {
          sessionId: sessionID,
          update: states.get(sessionID) ?? { sessionUpdate: "state_update", state: "unknown" },
        }),
      ),
    replayUpdates: (sessionID, updates) => {
      const messages = new Map<
        string,
        Extract<SessionUpdateV2, { sessionUpdate: "user_message" | "agent_message" | "agent_thought" }>
      >()
      const replay: SessionUpdateV2[] = []
      for (const update of updates) {
        if (
          update.sessionUpdate === "user_message_chunk" ||
          update.sessionUpdate === "agent_message_chunk" ||
          update.sessionUpdate === "agent_thought_chunk"
        ) {
          if (!update.messageId) continue
          const existing = messages.get(update.messageId)
          if (existing) {
            existing.content?.push(update.content)
            continue
          }
          const fields = { messageId: update.messageId, content: [update.content] }
          const message =
            update.sessionUpdate === "user_message_chunk"
              ? { sessionUpdate: "user_message" as const, ...fields }
              : update.sessionUpdate === "agent_message_chunk"
                ? { sessionUpdate: "agent_message" as const, ...fields }
                : { sessionUpdate: "agent_thought" as const, ...fields }
          messages.set(update.messageId, message)
          replay.push(message)
          continue
        }
        const translated = toSessionUpdate(update)
        if (translated) replay.push(translated)
      }
      return Effect.forEach(
        replay,
        (update) =>
          promise(() => agentConnection.client.notify(methods.client.session.update, { sessionId: sessionID, update })),
        { discard: true },
      )
    },
    sessionUpdate: (params) => {
      const update = toSessionUpdate(params.update)
      if (!update) return Effect.void
      return promise(() =>
        agentConnection.client.notify(methods.client.session.update, { sessionId: params.sessionId, update }),
      )
    },
    sessionState: (sessionID, state, stopReason, error) => {
      const update = stateUpdate(state, stopReason, error)
      states.set(sessionID, update)
      return promise(() =>
        agentConnection.client.notify(methods.client.session.update, { sessionId: sessionID, update }),
      )
    },
    userMessage: (sessionID, messageID, content) =>
      promise(() =>
        agentConnection.client.notify(methods.client.session.update, {
          sessionId: sessionID,
          update: {
            sessionUpdate: "user_message",
            messageId: messageID,
            content,
          },
        }),
      ),
    requestPermission: (params) =>
      promise((signal) =>
        agentConnection.client.request(
          methods.client.session.requestPermission,
          {
            sessionId: params.sessionId,
            title: params.toolCall.title || params.toolCall.name || "Permission required",
            subject: {
              type: "tool_call",
              toolCall: {
                ...params.toolCall,
                content: params.toolCall.content?.map(toV2ToolContent),
              },
            },
            options: params.options,
          },
          { cancellationSignal: signal },
        ),
      ).pipe(
        Effect.map((response) => ({
          outcome: RequestPermissionOutcome.isSelected(response.outcome)
            ? { outcome: "selected" as const, optionId: response.outcome.optionId }
            : { outcome: "cancelled" as const },
        })),
      ),
    extNotification: (method, params) => promise(() => agentConnection.client.notify(method, params)),
    createElicitation: (params) => {
      if (!CreateElicitationRequest.isForm(params)) return Effect.fail(RequestError.invalidParams())
      // SAFETY: the shared elicitation builder emits form schemas supported by both versions;
      // the v1 guard above validates the form payload. Only the SDK's extensible-union brands differ.
      const request = params as CreateElicitationRequestV2
      return promise((signal) =>
        agentConnection.client.request(methods.client.elicitation.create, request, { cancellationSignal: signal }),
      )
    },
    responded: (requestId) => {
      const responded = Deferred.makeUnsafe<void>()
      responses.set(requestId, responded)
      return Deferred.await(responded)
    },
  }
}

function stateUpdate(
  state: Parameters<ACPConnection.Interface["sessionState"]>[1],
  stopReason: Parameters<ACPConnection.Interface["sessionState"]>[2],
  error: Parameters<ACPConnection.Interface["sessionState"]>[3],
): SessionUpdateV2 {
  if (state === "running") return { sessionUpdate: "state_update", state }
  if (state === "requires_action") return { sessionUpdate: "state_update", state }
  if (state === "unknown") return { sessionUpdate: "state_update", state }
  switch (stopReason) {
    case "max_tokens":
      return { sessionUpdate: "state_update", state, stopReason }
    case "max_turn_requests":
      return { sessionUpdate: "state_update", state, stopReason }
    case "refusal":
      return { sessionUpdate: "state_update", state, stopReason }
    case "cancelled":
      return { sessionUpdate: "state_update", state, stopReason }
    case "error":
      return { sessionUpdate: "state_update", state, stopReason, error }
    default:
      return { sessionUpdate: "state_update", state, stopReason: "end_turn" }
  }
}

function toSessionUpdate(update: SessionUpdate): SessionUpdateV2 | undefined {
  switch (update.sessionUpdate) {
    case "tool_call":
      const { sessionUpdate: _sessionUpdate, ...toolCall } = update
      return {
        sessionUpdate: "tool_call_update",
        ...toolCall,
        content: toolCall.content?.map(toV2ToolContent),
      }
    case "tool_call_update":
      return {
        ...update,
        content: update.content?.map(toV2ToolContent),
      }
    case "config_option_update":
      return {
        ...update,
        configOptions: update.configOptions.map(toConfigOption),
      }
    case "user_message_chunk":
      if (!update.messageId) return undefined
      return { ...update, messageId: update.messageId }
    case "agent_message_chunk":
      if (!update.messageId) return undefined
      return { ...update, messageId: update.messageId }
    case "agent_thought_chunk":
      if (!update.messageId) return undefined
      return { ...update, messageId: update.messageId }
    case "available_commands_update":
      return {
        ...update,
        availableCommands: update.availableCommands.map((command) => ({
          ...command,
          input: command.input ? { type: "text", ...command.input } : undefined,
        })),
      }
    case "compaction_update":
    case "compaction_summary_chunk":
    case "session_info_update":
    case "usage_update":
      return update
    default:
      return undefined
  }
}

function toV2ToolContent(content: ToolCallContentV1): ToolCallContentV2 {
  if (content.type !== "diff") return content
  const change =
    content.oldText == null
      ? { operation: "add" as const, path: content.path, fileType: "text" }
      : { operation: "modify" as const, path: content.path, fileType: "text" }
  return {
    type: "diff" as const,
    changes: [change],
    patch: {
      format: "git_patch",
      text: createTwoFilesPatch(
        content.oldText == null ? "/dev/null" : content.path,
        content.path,
        content.oldText ?? "",
        content.newText,
      ),
    },
  }
}

function toConfigOption(option: SessionConfigOption): SessionConfigOptionV2 {
  const { id, ...rest } = option
  if (rest.type === "boolean") return { configId: id, ...rest }
  if (rest.options.every((item) => "group" in item)) {
    return { configId: id, ...rest, options: rest.options.map(({ group, ...item }) => ({ groupId: group, ...item })) }
  }
  return { configId: id, ...rest, options: rest.options }
}

function initialize(service: ACPService.Interface, params: InitializeRequestV2) {
  return service
    .initialize({
      protocolVersion: 1,
      clientCapabilities: {
        auth: params.capabilities?.auth?.terminal != null ? { terminal: true } : undefined,
        session: { compaction: {} },
        elicitation: params.capabilities?.elicitation?.form != null ? { form: {} } : undefined,
        _meta: params.capabilities?._meta ?? undefined,
      },
    })
    .pipe(
      Effect.map(() => ({
        protocolVersion: 2,
        info: { name: "opencode", title: "OpenCode", version: OPENCODE_VERSION },
        capabilities: {
          session: {
            prompt: { image: {}, embeddedContext: {} },
            mcp: { stdio: {}, http: {} },
            delete: {},
            fork: {},
            additionalDirectories: {},
          },
          _meta: { [ACPCapabilities.ChildSessionUpdates]: true },
        },
        authMethods:
          params.capabilities?.auth?.terminal != null
            ? [
                {
                  type: "terminal" as const,
                  methodId: "opencode-login",
                  name: "Login with OpenCode",
                  description: "Run opencode auth login in the terminal",
                  args: ["--login"],
                },
              ]
            : [],
      })),
    )
}

function toMcpServer(server: McpServer): Effect.Effect<McpServerV1, ACPError.Failure> {
  if (McpServer.isStdio(server)) {
    return Effect.succeed({
      name: server.name,
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? [],
    })
  }
  if (McpServer.isHttp(server)) return Effect.succeed({ ...server, headers: server.headers ?? [] })
  return Effect.fail(
    new ACPError.InvalidRequestError({
      message: `Unsupported MCP server transport: ${server.type}`,
      field: "mcpServers",
    }),
  )
}

function options(servers: readonly McpServer[] | undefined) {
  return Effect.forEach(servers ?? [], toMcpServer)
}

function configOptions(options: SessionConfigOption[]) {
  return options.map(toConfigOption)
}

function newSession(service: ACPService.Interface, params: NewSessionRequest) {
  return options(params.mcpServers).pipe(
    Effect.flatMap((mcpServers) =>
      service.newSession({
        cwd: params.cwd,
        additionalDirectories: params.additionalDirectories,
        mcpServers,
      }),
    ),
    Effect.tap((response) => service.observeSession(response.sessionId)),
    Effect.map((response) => ({
      sessionId: response.sessionId,
      ...(response.configOptions ? { configOptions: configOptions(response.configOptions) } : {}),
    })),
  )
}

function forkSession(service: ACPService.Interface, params: ForkSessionRequest) {
  return options(params.mcpServers).pipe(
    Effect.flatMap((mcpServers) => service.forkSession({ ...params, mcpServers })),
    Effect.tap((response) => service.observeSession(response.sessionId)),
    Effect.map((response) => ({
      sessionId: response.sessionId,
      configOptions: response.configOptions?.map(toConfigOption),
    })),
  )
}

function resumeSession(service: ACPService.Interface, params: ResumeSessionRequest) {
  if (params.replayFrom && params.replayFrom.type !== "start")
    return Effect.fail(
      new ACPError.InvalidRequestError({
        message: `Unsupported replay cursor: ${params.replayFrom.type}`,
        field: "replayFrom",
      }),
    )
  return options(params.mcpServers).pipe(
    Effect.flatMap((mcpServers) => {
      const request = {
        sessionId: params.sessionId,
        cwd: params.cwd,
        additionalDirectories: params.additionalDirectories,
        mcpServers,
      }
      const resumed =
        params.replayFrom?.type === "start" ? service.loadSession(request) : service.resumeSession(request)
      return resumed.pipe(
        Effect.tap(() => service.observeSession(params.sessionId)),
        Effect.tap(() => service.sessionSnapshot(params.sessionId)),
        Effect.map((response) => ({
          ...(response.configOptions ? { configOptions: configOptions(response.configOptions) } : {}),
        })),
      )
    }),
  )
}

function setConfigOption(service: ACPService.Interface, params: SetSessionConfigOptionRequest) {
  if (params.type !== "id" || typeof params.value !== "string")
    return Effect.fail(new ACPError.InvalidConfigOptionError({ configId: params.configId }))
  return service
    .setSessionConfigOption({
      sessionId: params.sessionId,
      configId: params.configId,
      value: params.value,
    })
    .pipe(Effect.map((response) => ({ configOptions: configOptions(response.configOptions) })))
}

function prompt(service: ACPService.Interface, params: PromptRequest, signal: AbortSignal) {
  return Effect.forEach(params.prompt, (content) => {
    if (
      ContentBlock.isText(content) ||
      ContentBlock.isImage(content) ||
      ContentBlock.isAudio(content) ||
      ContentBlock.isResourceLink(content) ||
      ContentBlock.isResource(content)
    )
      return Effect.succeed({
        ...content,
        annotations: content.annotations
          ? {
              ...content.annotations,
              audience: content.annotations.audience?.filter(
                (role): role is "assistant" | "user" => role === "assistant" || role === "user",
              ),
            }
          : content.annotations,
      })
    return Effect.fail(
      new ACPError.InvalidRequestError({ message: `Unsupported prompt content: ${content.type}`, field: "prompt" }),
    )
  }).pipe(
    Effect.flatMap((content) =>
      service.promptAccepted(
        {
          sessionId: params.sessionId,
          prompt: content,
        },
        signal,
      ),
    ),
    Effect.map((messageId) => ({ messageId })),
  )
}

export * as ACPAgentV2 from "./agent-v2"
