import type {
  HealthGetOutput,
  LocationGetInput,
  LocationGetOutput,
  AgentListInput,
  AgentListOutput,
  PluginListInput,
  PluginListOutput,
  SessionListInput,
  SessionListOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionActiveOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionForkInput,
  SessionForkOutput,
  SessionSwitchAgentInput,
  SessionSwitchAgentOutput,
  SessionSwitchModelInput,
  SessionSwitchModelOutput,
  SessionRenameInput,
  SessionRenameOutput,
  SessionPromptInput,
  SessionPromptOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionSkillInput,
  SessionSkillOutput,
  SessionSyntheticInput,
  SessionSyntheticOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionWaitInput,
  SessionWaitOutput,
  SessionRevertStageInput,
  SessionRevertStageOutput,
  SessionRevertClearInput,
  SessionRevertClearOutput,
  SessionRevertCommitInput,
  SessionRevertCommitOutput,
  SessionContextInput,
  SessionContextOutput,
  SessionListContextEntriesInput,
  SessionListContextEntriesOutput,
  SessionPutContextEntryInput,
  SessionPutContextEntryOutput,
  SessionRemoveContextEntryInput,
  SessionRemoveContextEntryOutput,
  SessionLogInput,
  SessionLogOutput,
  SessionInterruptInput,
  SessionInterruptOutput,
  SessionBackgroundInput,
  SessionBackgroundOutput,
  SessionMessageInput,
  SessionMessageOutput,
  MessageListInput,
  MessageListOutput,
  ModelListInput,
  ModelListOutput,
  ModelDefaultInput,
  ModelDefaultOutput,
  GenerateTextInput,
  GenerateTextOutput,
  ProviderListInput,
  ProviderListOutput,
  ProviderGetInput,
  ProviderGetOutput,
  IntegrationListInput,
  IntegrationListOutput,
  IntegrationGetInput,
  IntegrationGetOutput,
  IntegrationConnectKeyInput,
  IntegrationConnectKeyOutput,
  IntegrationConnectOauthInput,
  IntegrationConnectOauthOutput,
  IntegrationAttemptStatusInput,
  IntegrationAttemptStatusOutput,
  IntegrationAttemptCompleteInput,
  IntegrationAttemptCompleteOutput,
  IntegrationAttemptCancelInput,
  IntegrationAttemptCancelOutput,
  ServerMcpListInput,
  ServerMcpListOutput,
  CredentialUpdateInput,
  CredentialUpdateOutput,
  CredentialRemoveInput,
  CredentialRemoveOutput,
  ProjectCurrentInput,
  ProjectCurrentOutput,
  ProjectDirectoriesInput,
  ProjectDirectoriesOutput,
  PermissionListRequestsInput,
  PermissionListRequestsOutput,
  PermissionListSavedInput,
  PermissionListSavedOutput,
  PermissionRemoveSavedInput,
  PermissionRemoveSavedOutput,
  PermissionCreateInput,
  PermissionCreateOutput,
  PermissionListInput,
  PermissionListOutput,
  PermissionGetInput,
  PermissionGetOutput,
  PermissionReplyInput,
  PermissionReplyOutput,
  FileReadInput,
  FileReadOutput,
  FileListInput,
  FileListOutput,
  FileFindInput,
  FileFindOutput,
  CommandListInput,
  CommandListOutput,
  SkillListInput,
  SkillListOutput,
  EventSubscribeOutput,
  EventChangesOutput,
  PtyListInput,
  PtyListOutput,
  PtyCreateInput,
  PtyCreateOutput,
  PtyGetInput,
  PtyGetOutput,
  PtyUpdateInput,
  PtyUpdateOutput,
  PtyRemoveInput,
  PtyRemoveOutput,
  ShellListInput,
  ShellListOutput,
  ShellCreateInput,
  ShellCreateOutput,
  ShellGetInput,
  ShellGetOutput,
  ShellOutputInput,
  ShellOutputOutput,
  ShellRemoveInput,
  ShellRemoveOutput,
  QuestionListRequestsInput,
  QuestionListRequestsOutput,
  QuestionListInput,
  QuestionListOutput,
  QuestionReplyInput,
  QuestionReplyOutput,
  QuestionRejectInput,
  QuestionRejectOutput,
  ReferenceListInput,
  ReferenceListOutput,
  ProjectCopyCreateInput,
  ProjectCopyCreateOutput,
  ProjectCopyRemoveInput,
  ProjectCopyRemoveOutput,
  ProjectCopyRefreshInput,
  ProjectCopyRefreshOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
  readonly binary?: true
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.binary) return new Uint8Array(await response.arrayBuffer()) as A
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agent: {
      list: (input?: AgentListInput, requestOptions?: RequestOptions) =>
        request<AgentListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    plugin: {
      list: (input?: PluginListInput, requestOptions?: RequestOptions) =>
        request<PluginListOutput>(
          {
            method: "GET",
            path: `/api/plugin`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    session: {
      list: (input?: SessionListInput, requestOptions?: RequestOptions) =>
        request<SessionListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              parentID: input?.["parentID"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<SessionActiveOutput>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      fork: (input: SessionForkInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionForkOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
            body: { messageID: input["messageID"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      switchAgent: (input: SessionSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      rename: (input: SessionRenameInput, requestOptions?: RequestOptions) =>
        request<SessionRenameOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/rename`,
            body: { title: input["title"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: { id: input["id"], prompt: input["prompt"], delivery: input["delivery"], resume: input["resume"] },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      command: (input: SessionCommandInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionCommandOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
            body: {
              id: input["id"],
              command: input["command"],
              arguments: input["arguments"],
              agent: input["agent"],
              model: input["model"],
              files: input["files"],
              agents: input["agents"],
              delivery: input["delivery"],
              resume: input["resume"],
            },
            successStatus: 200,
            declaredStatuses: [409, 404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      skill: (input: SessionSkillInput, requestOptions?: RequestOptions) =>
        request<SessionSkillOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/skill`,
            body: { id: input["id"], skill: input["skill"], resume: input["resume"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) =>
        request<SessionSyntheticOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/synthetic`,
            body: { text: input["text"], description: input["description"], metadata: input["metadata"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      compact: (input: SessionCompactInput, requestOptions?: RequestOptions) =>
        request<SessionCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 409, 503, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      wait: (input: SessionWaitInput, requestOptions?: RequestOptions) =>
        request<SessionWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      revertStage: (input: SessionRevertStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionRevertStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 409, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      revertClear: (input: SessionRevertClearInput, requestOptions?: RequestOptions) =>
        request<SessionRevertClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 409, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      revertCommit: (input: SessionRevertCommitInput, requestOptions?: RequestOptions) =>
        request<SessionRevertCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 409, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      listContextEntries: (input: SessionListContextEntriesInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionListContextEntriesOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context-entry`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      putContextEntry: (input: SessionPutContextEntryInput, requestOptions?: RequestOptions) =>
        request<SessionPutContextEntryOutput>(
          {
            method: "PUT",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context-entry/${encodeURIComponent(input.key)}`,
            body: { value: input["value"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      removeContextEntry: (input: SessionRemoveContextEntryInput, requestOptions?: RequestOptions) =>
        request<SessionRemoveContextEntryOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context-entry/${encodeURIComponent(input.key)}`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      log: (input: SessionLogInput, requestOptions?: RequestOptions): AsyncIterable<SessionLogOutput> =>
        sse<SessionLogOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/log`,
            query: { after: input["after"], follow: input["follow"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    message: {
      list: (input: MessageListInput, requestOptions?: RequestOptions) =>
        request<MessageListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    model: {
      list: (input?: ModelListInput, requestOptions?: RequestOptions) =>
        request<ModelListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      default: (input?: ModelDefaultInput, requestOptions?: RequestOptions) =>
        request<ModelDefaultOutput>(
          {
            method: "GET",
            path: `/api/model/default`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    generate: {
      text: (input: GenerateTextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: GenerateTextOutput }>(
          {
            method: "POST",
            path: `/api/generate`,
            query: { location: input["location"] },
            body: { prompt: input["prompt"], model: input["model"] },
            successStatus: 200,
            declaredStatuses: [400, 503, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    provider: {
      list: (input?: ProviderListInput, requestOptions?: RequestOptions) =>
        request<ProviderListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProviderGetInput, requestOptions?: RequestOptions) =>
        request<ProviderGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    integration: {
      list: (input?: IntegrationListInput, requestOptions?: RequestOptions) =>
        request<IntegrationListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.mcp": {
      list: (input?: ServerMcpListInput, requestOptions?: RequestOptions) =>
        request<ServerMcpListOutput>(
          {
            method: "GET",
            path: `/api/mcp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    credential: {
      update: (input: CredentialUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    project: {
      current: (input?: ProjectCurrentInput, requestOptions?: RequestOptions) =>
        request<ProjectCurrentOutput>(
          {
            method: "GET",
            path: `/api/project/current`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      directories: (input: ProjectDirectoriesInput, requestOptions?: RequestOptions) =>
        request<ProjectDirectoriesOutput>(
          {
            method: "GET",
            path: `/api/project/${encodeURIComponent(input.projectID)}/directories`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    permission: {
      listRequests: (input?: PermissionListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    file: {
      read: (input: FileReadInput, requestOptions?: RequestOptions) =>
        request<FileReadOutput>(
          {
            method: "GET",
            path: `/api/fs/read/${encodePath(input.path)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
            binary: true,
          },
          requestOptions,
        ),
      list: (input?: FileListInput, requestOptions?: RequestOptions) =>
        request<FileListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FileFindInput, requestOptions?: RequestOptions) =>
        request<FileFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    command: {
      list: (input?: CommandListInput, requestOptions?: RequestOptions) =>
        request<CommandListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skill: {
      list: (input?: SkillListInput, requestOptions?: RequestOptions) =>
        request<SkillListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    event: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventSubscribeOutput> =>
        sse<EventSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
      changes: (requestOptions?: RequestOptions): AsyncIterable<EventChangesOutput> =>
        sse<EventChangesOutput>(
          { method: "GET", path: `/api/event/changes`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    pty: {
      list: (input?: PtyListInput, requestOptions?: RequestOptions) =>
        request<PtyListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtyCreateInput, requestOptions?: RequestOptions) =>
        request<PtyCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtyGetInput, requestOptions?: RequestOptions) =>
        request<PtyGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtyUpdateInput, requestOptions?: RequestOptions) =>
        request<PtyUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtyRemoveInput, requestOptions?: RequestOptions) =>
        request<PtyRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    shell: {
      list: (input?: ShellListInput, requestOptions?: RequestOptions) =>
        request<ShellListOutput>(
          {
            method: "GET",
            path: `/api/shell`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ShellCreateInput, requestOptions?: RequestOptions) =>
        request<ShellCreateOutput>(
          {
            method: "POST",
            path: `/api/shell`,
            query: { location: input["location"] },
            body: {
              command: input["command"],
              cwd: input["cwd"],
              timeout: input["timeout"],
              metadata: input["metadata"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ShellGetInput, requestOptions?: RequestOptions) =>
        request<ShellGetOutput>(
          {
            method: "GET",
            path: `/api/shell/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      output: (input: ShellOutputInput, requestOptions?: RequestOptions) =>
        request<ShellOutputOutput>(
          {
            method: "GET",
            path: `/api/shell/${encodeURIComponent(input.id)}/output`,
            query: { location: input["location"], cursor: input["cursor"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ShellRemoveInput, requestOptions?: RequestOptions) =>
        request<ShellRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/shell/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    question: {
      listRequests: (input?: QuestionListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    reference: {
      list: (input?: ReferenceListInput, requestOptions?: RequestOptions) =>
        request<ReferenceListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopy: {
      create: (input: ProjectCopyCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopyCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopyRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopyRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopyRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopyRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/")
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
