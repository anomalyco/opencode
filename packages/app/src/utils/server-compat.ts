import type { ServerApi } from "./server"
import type { ServerProtocol } from "./server-protocol"
import type { AgentPartInput, FilePartInput, OpencodeClient, Session, TextPartInput } from "@opencode-ai/sdk/v2/client"
type Project = { id: string; worktree?: string; [key: string]: any }
type ProjectCurrent = { id: string; directory: string }
type SessionApi = any
type SessionCommandInput = any
type SessionCommandOutput = any
type SessionCompactInput = any
type SessionCompactOutput = any
type SessionInfo = {
  id: string
  parentID?: string | null
  projectID: string
  agent?: string
  model?: any
  cost?: number
  tokens?: any
  time: any
  title?: string
  location?: any
  subpath?: string
  revert?: any
}
type SessionPromptInput = any
type SessionPromptOutput = any
type SessionShellInput = any
type SessionShellOutput = any

type LegacyClient = OpencodeClient
type LegacyFor = (directory?: string) => LegacyClient
type CompatibleSessionApi = Omit<
  SessionApi,
  "prompt" | "command" | "shell" | "compact" | "rename" | "archive" | "remove"
> & {
  prompt: (input: SessionPromptInput & LegacyPrompt) => Promise<SessionPromptOutput>
  command: (input: SessionCommandInput) => Promise<SessionCommandOutput>
  shell: (input: SessionShellInput & LegacyPrompt) => Promise<SessionShellOutput>
  compact: (input: SessionCompactInput & { model?: LegacyPrompt["model"] }) => Promise<SessionCompactOutput>
  rename: (input: { sessionID: string; title?: string } & LegacyLocation) => Promise<void>
  archive: (input: { sessionID: string } & LegacyLocation) => Promise<void>
  remove: (input: { sessionID: string } & LegacyLocation) => Promise<void>
}
type CompatiblePermissionApi = Omit<ServerApi["permission"], "reply"> & {
  request?: {
    list?: (input?: { location?: { directory?: string } }) => Promise<{ data: any[] }>
  }
  reply: (
    input: {
      sessionID?: string
      requestID?: string
      permissionID?: string
      reply?: string
      response?: string
      location?: { directory?: string }
    } & Record<string, any>,
  ) => Promise<any>
}
type CompatibleQuestionApi = Omit<ServerApi["question"], "reply" | "reject"> & {
  request?: {
    list?: (input?: { location?: { directory?: string } }) => Promise<{ data: any[] }>
  }
  reply: (input: Parameters<ServerApi["question"]["reply"]>[0]) => ReturnType<ServerApi["question"]["reject"]>
  reject: (input: Parameters<ServerApi["question"]["reject"]>[0]) => ReturnType<ServerApi["question"]["reject"]>
}
export type CompatibleApi = Omit<ServerApi, "session" | "permission" | "question"> & {
  readonly session: CompatibleSessionApi
  readonly permission: CompatiblePermissionApi
  readonly question: CompatibleQuestionApi
}
type LegacyPrompt = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  legacyParts?: (TextPartInput | FilePartInput | AgentPartInput)[]
  text?: string
  files?: {
    uri: string
    name?: string
    mention?: { text: string; start: number; end: number }
  }[]
  agents?: {
    name: string
    mention?: { text: string; start: number; end: number }
  }[]
}
type LegacyLocation = { directory?: string }
type CompatibleInput = {
  protocol: Promise<ServerProtocol>
  current: ServerApi
  legacy: LegacyFor
  directory?: string
}

function mime(uri: string) {
  const match = /^data:([^;,]+)/.exec(uri)
  return match?.[1] ?? "application/octet-stream"
}

function sessionInfo(session: Session): SessionInfo {
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID,
    agent: session.agent,
    model: session.model && {
      id: session.model.id,
      providerID: session.model.providerID,
      variant: session.model.variant,
    },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: session.time,
    title: session.title,
    location: { directory: session.directory, workspaceID: session.workspaceID },
    subpath: session.path,
    revert: session.revert && {
      messageID: session.revert.messageID,
      partID: session.revert.partID,
      snapshot: session.revert.snapshot,
    },
  }
}

export function createCompatibleApi(input: CompatibleInput): CompatibleApi {
  const v1 = createV1Api(input)
  const currentSession = (input.current as any)?.sessions ?? input.current?.session ?? {}
  const currentWithRevert: ServerApi = {
    ...input.current,
    session: {
      ...currentSession,
      revert: currentSession.revert ?? {
        stage: (value: any, opts?: any) => currentSession.stage?.(value, opts),
        clear: (value: any, opts?: any) => currentSession.clear?.(value, opts),
        commit: (value: any, opts?: any) => currentSession.commit?.(value, opts),
      },
    },
  } as unknown as ServerApi

  return lazyApi(
    input.protocol.then((protocol) => (protocol === "v1" ? v1 : currentWithRevert)),
    v1,
  )
}

function lazyApi<T extends object>(implementation: Promise<T>, shape: T): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(shape, {
    get(target, property, receiver) {
      const sample = Reflect.get(target, property, receiver)
      if (typeof sample === "function") {
        return (...args: unknown[]) =>
          implementation.then((value) => {
            const method = Reflect.get(value, property)
            if (typeof method !== "function") throw new Error(`API method unavailable: ${String(property)}`)
            return Reflect.apply(method, value, args)
          })
      }
      if (sample === null || typeof sample !== "object") return sample
      if (cache.has(property)) return cache.get(property)
      const nested = lazyApi(
        implementation.then((value) => {
          const result = Reflect.get(value, property)
          if (result === null || typeof result !== "object") {
            throw new Error(`API namespace unavailable: ${String(property)}`)
          }
          return result
        }),
        sample,
      )
      cache.set(property, nested)
      return nested
    },
  })
}

function createV1Api(input: CompatibleInput): CompatibleApi {
  const directory = (location?: { directory?: string }) => location?.directory ?? input.directory
  const legacy = (location?: { directory?: string }) => input.legacy(directory(location))
  const located = <T>(data: T, value?: { directory?: string }) => ({
    location: {
      directory: directory(value) ?? "",
      project: { id: "", directory: directory(value) ?? "" },
    },
    data,
  })

  const currentSession = (input.current as any)?.sessions ?? input.current?.session ?? {}
  const currentProject = (input.current as any)?.projects ?? input.current?.project ?? {}
  const currentPath = (input.current as any)?.paths ?? input.current?.path ?? {}
  const currentFile = (input.current as any)?.files ?? input.current?.file ?? {}
  const currentVcs = (input.current as any)?.vcs ?? {}
  const currentIntegration = (input.current as any)?.integrations ?? input.current?.integration ?? {}
  const currentPty = (input.current as any)?.ptys ?? input.current?.pty ?? {}
  const currentPermission = (input.current as any)?.permissions ?? input.current?.permission ?? {}
  const currentQuestion = (input.current as any)?.questions ?? input.current?.question ?? {}
  const currentCommand = (input.current as any)?.commands ?? input.current?.command ?? {}
  const currentAgent = (input.current as any)?.agents ?? input.current?.agent ?? {}
  const currentReference = (input.current as any)?.references ?? input.current?.reference ?? {}
  const currentProvider = (input.current as any)?.providers ?? input.current?.provider ?? {}
  const currentModel = (input.current as any)?.models ?? input.current?.model ?? {}

  const permissionObj = {
    ...currentPermission,
    request: {
      async list(value?: { location?: { directory?: string } }) {
        const val = value as any
        if (currentPermission?.listRequests) return currentPermission.listRequests(val)
        if (currentPermission?.request?.list) return currentPermission.request.list(val)
        const result = await legacy(val?.location).permission.list()
        return located(result.data ?? [], val?.location)
      },
    },
    async reply(value: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } }) {
      const input = value as any
      await legacy(input.location).permission.respond({
        sessionID: input.sessionID ?? "",
        permissionID: input.requestID ?? input.permissionID,
        response: input.reply ?? input.response,
        directory: directory(input.location),
      })
    },
  }
  const questionObj = {
    ...currentQuestion,
    request: {
      async list(value?: { location?: { directory?: string } }) {
        const val = value as any
        if (currentQuestion?.listRequests) return currentQuestion.listRequests(val)
        if (currentQuestion?.request?.list) return currentQuestion.request.list(val)
        const result = await legacy(val?.location).question.list()
        return located(result.data ?? [], val?.location)
      },
    },
    async reply(value: Parameters<ServerApi["question"]["reply"]>[0]) {
      const val = value as any
      await legacy().question.reply({
        requestID: val?.requestID,
        answers: (val?.answers ?? []).map((answer: any) => [...answer]),
      })
    },
    async reject(value: Parameters<ServerApi["question"]["reject"]>[0]) {
      const val = value as any
      await legacy().question.reject({ requestID: val?.requestID })
    },
  }
  const commandObj = {
    ...currentCommand,
    async list(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentCommand?.list) return currentCommand.list(val)
      const result = await legacy(val?.location).command.list()
      return located(result.data ?? [], val?.location)
    },
  }
  const agentObj = {
    ...currentAgent,
    async list(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentAgent?.list) return currentAgent.list(val)
      const result = await legacy(val?.location).app.agents()
      return located(result.data ?? [], val?.location)
    },
  }
  const referenceObj = {
    ...currentReference,
    async list(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentReference?.list) return currentReference.list(val)
      const result = await legacy(val?.location).v2.reference.list()
      return located(result.data?.data ?? [], val?.location)
    },
  }
  const providerObj = {
    ...currentProvider,
    async list(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentProvider?.list) return currentProvider.list(val)
      const result = await legacy(val?.location).provider.list()
      return located(result.data ?? [], val?.location)
    },
  }
  const modelObj = {
    ...currentModel,
    async list(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentModel?.list) return currentModel.list(val)
      const result = await (legacy(val?.location) as any).model?.list?.()
      return located(result?.data ?? [], val?.location)
    },
    async default(value?: { location?: { directory?: string } }) {
      const val = value as any
      if (currentModel?.default) return currentModel.default(val)
      const result = await (legacy(val?.location) as any).model?.default?.()
      return located(result?.data, val?.location)
    },
  }

  return {
    ...input.current,
    session: {
      ...currentSession,
      async list(
        value?: Parameters<ServerApi["session"]["list"]>[0],
        options?: Parameters<ServerApi["session"]["list"]>[1],
      ) {
        const val = value as any
        if (!val?.directory && val?.search !== undefined) {
          const result = await legacy().experimental.session.list(
            {
              roots: val.parentID === null ? true : undefined,
              search: val.search,
              limit: val.limit,
            },
            options as any,
          )
          return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
        }
        const result = await legacy({ directory: val?.directory }).session.list({
          directory: val?.directory,
          roots: val?.parentID === null ? true : undefined,
          search: val?.search,
          limit: val?.limit,
        })
        return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
      },
      async create(value?: Parameters<ServerApi["session"]["create"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location ?? undefined).session.create({
          directory: directory(val?.location ?? undefined),
        })
        if (!result.data) throw new Error("Failed to create session")
        return sessionInfo(result.data)
      },
      async get(value: Parameters<ServerApi["session"]["get"]>[0]) {
        const val = value as any
        const result = await legacy().session.get(val)
        if (!result.data) throw new Error(`Session not found: ${val?.sessionID}`)
        return sessionInfo(result.data)
      },
      async active() {
        const result = await legacy().session.status()
        return Object.fromEntries(
          Object.entries(result.data ?? {}).flatMap(([sessionID, status]) =>
            status.type === "idle" ? [] : [[sessionID, { type: "running" as const }]],
          ),
        )
      },
      async rename(value: { sessionID: string; title?: string } & LegacyLocation) {
        const val = value as any
        await legacy(val).session.update({ sessionID: val.sessionID, title: val.title })
      },
      async archive(value: { sessionID: string } & LegacyLocation) {
        const val = value as any
        await legacy(val).session.update({ sessionID: val.sessionID, time: { archived: Date.now() } })
      },
      async remove(value: { sessionID: string } & LegacyLocation) {
        const val = value as any
        await legacy(val).session.delete(val)
      },
      async fork(value: Parameters<ServerApi["session"]["fork"]>[0]) {
        const val = value as any
        const result = await legacy().session.fork(val)
        if (!result.data) throw new Error("Failed to fork session")
        return sessionInfo(result.data)
      },
      async interrupt(value: Parameters<ServerApi["session"]["interrupt"]>[0]) {
        const val = value as any
        await legacy().session.abort(val)
      },
      async prompt(value: SessionPromptInput & LegacyPrompt) {
        const val = value as any
        await legacy().session.promptAsync({
          sessionID: val.sessionID,
          messageID: val.id ?? undefined,
          agent: val.agent,
          model: val.model,
          variant: val.variant,
          parts: val.parts ?? val.legacyParts ?? [
            ...(val.text !== undefined && val.text !== null ? [{ type: "text" as const, text: val.text }] : []),
            ...(val.files ?? []).map((file: any) => ({
              type: "file" as const,
              mime: file.mention ? "text/plain" : mime(file.uri),
              url: file.uri,
              filename: file.name,
              source: file.mention
                ? {
                    type: "file" as const,
                    text: { value: file.mention.text, start: file.mention.start, end: file.mention.end },
                    path: file.uri,
                  }
                : undefined,
            })),
            ...(val.agents ?? []).map((agent: any) => ({
              type: "agent" as const,
              name: agent.name,
              source: agent.mention
                ? { value: agent.mention.text, start: agent.mention.start, end: agent.mention.end }
                : undefined,
            })),
          ],
        })
        return {
          admittedSeq: 0,
          id: val.id ?? "",
          sessionID: val.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: val.text },
          delivery: val.delivery ?? "steer",
        }
      },
      async command(value: SessionCommandInput) {
        const val = value as any
        await legacy().session.command({
          sessionID: val.sessionID,
          messageID: val.id ?? undefined,
          command: val.command,
          arguments: val.arguments ?? "",
          agent: val.agent ?? undefined,
          model: val.model ? `${val.model.providerID}/${val.model.id}` : undefined,
          variant: val.model?.variant,
          parts: val.files?.map((file: any) => ({
            type: "file" as const,
            mime: mime(file.uri),
            url: file.uri,
            filename: file.name,
          })),
        })
        return {
          admittedSeq: 0,
          id: val.id ?? "",
          sessionID: val.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: `/${val.command} ${val.arguments ?? ""}`.trim() },
          delivery: val.delivery ?? "steer",
        }
      },
      async shell(value: SessionShellInput & LegacyPrompt) {
        const val = value as any
        await legacy().session.shell({
          sessionID: val.sessionID,
          command: val.command,
          agent: val.agent,
          model: val.model,
        })
      },
      compact: async (value: SessionCompactInput & { model?: LegacyPrompt["model"] }) => {
        const val = value as any
        if (!val.model) throw new Error("A model is required to compact a V1 session")
        await legacy().session.summarize({
          sessionID: val.sessionID,
          providerID: val.model.providerID,
          modelID: val.model.modelID,
        })
        return {
          admittedSeq: 0,
          id: val.id ?? "",
          sessionID: val.sessionID,
          timeCreated: Date.now(),
          type: "compaction",
        }
      },
      revert: {
        stage: async (value: { sessionID: string; messageID: string; files?: string[] }) => {
          await legacy().session.revert(value)
          return { messageID: value.messageID }
        },
        clear: async (value: { sessionID: string }) => {
          await legacy().session.unrevert(value)
        },
        commit: async (value: { sessionID: string }) => {
          const currentSession = (input.current as any)?.sessions ?? input.current?.session
          if (currentSession?.revert?.commit) return currentSession.revert.commit(value)
          if (currentSession?.commit) return currentSession.commit(value)
        },
      },
    },
    project: {
      ...currentProject,
      async list() {
        return ((await legacy().project.list()).data ?? []) as Project[]
      },
      async current(value?: Parameters<ServerApi["project"]["current"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).project.current()
        if (!result.data) throw new Error("Project not found")
        return { id: result.data.id, directory: result.data.worktree, vcs: (result.data as any).vcs } as ProjectCurrent
      },
      async update(value: Parameters<ServerApi["project"]["update"]>[0]) {
        const val = value as any
        const project = (await legacy().project.list()).data?.find((item) => item.id === val.projectID)
        const result = await legacy({ directory: project?.worktree }).project.update({
          ...val,
          directory: project?.worktree,
        })
        if (!result.data) throw new Error(`Project not found: ${val.projectID}`)
        return result.data as Project
      },
      async directories(value: Parameters<ServerApi["project"]["directories"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).worktree.list()
        return (result.data ?? []).map((item) => ({ directory: item }))
      },
    },
    path: {
      ...currentPath,
      async get(value?: Parameters<ServerApi["path"]["get"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).path.get()
        if (!result.data) throw new Error("Path unavailable")
        return result.data
      },
    },
    vcs: {
      ...currentVcs,
      async get(value?: Parameters<ServerApi["vcs"]["get"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).vcs.get()
        return located({ branch: result.data?.branch, defaultBranch: result.data?.default_branch }, val?.location)
      },
      async status(value?: Parameters<ServerApi["vcs"]["status"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).vcs.status()
        return located(result.data ?? [], val?.location)
      },
      async diff(value: Parameters<ServerApi["vcs"]["diff"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).vcs.diff({
          mode: val?.mode === "working" ? "git" : val?.mode,
          context: val?.context,
        })
        return located(
          (result.data ?? []).map((file: any) => ({
            file: file.file,
            patch: file.patch ?? "",
            additions: file.additions,
            deletions: file.deletions,
            status: file.status ?? "modified",
          })),
          val?.location,
        )
      },
    },
    file: {
      ...currentFile,
      async list(value?: Parameters<ServerApi["file"]["list"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).file.list({ path: val?.path ?? "" })
        return located(result.data ?? [], val?.location)
      },
      async find(value: Parameters<ServerApi["file"]["find"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).find.files({
          query: val?.query,
          dirs: val?.type === undefined ? undefined : val?.type === "directory" ? "true" : "false",
          limit: val?.limit,
        })
        return located(
          (result.data ?? []).map((path: string) => ({ path, type: val?.type ?? "file" })),
          val?.location,
        )
      },
    },
    integration: {
      ...currentIntegration,
      async get(value: Parameters<ServerApi["integration"]["get"]>[0]) {
        const val = value as any
        const methods = ((await legacy(val?.location).provider.auth()).data?.[val?.integrationID] ?? []).map(
          (method: any, index: number) =>
            method.type === "api"
              ? { type: "key" as const, label: method.label }
              : { type: "oauth" as const, id: String(index), label: method.label, prompts: method.prompts },
        )
        return located(
          {
            id: val?.integrationID,
            name: val?.integrationID,
            methods,
            connections: [],
          },
          val?.location,
        )
      },
      connect: {
        ...(currentIntegration.connect ?? {}),
        key: async (value: Parameters<ServerApi["integration"]["connect"]["key"]>[0]) => {
          const val = value as any
          await legacy(val?.location).auth.set({
            providerID: val?.integrationID,
            auth: { type: "api", key: val?.key },
          })
        },
      },
      oauth: {
        ...(currentIntegration.oauth ?? {}),
        connect: async (value: Parameters<ServerApi["integration"]["oauth"]["connect"]>[0]) => {
          const val = value as any
          const method = Number(val?.methodID)
          const result = await legacy(val?.location).provider.oauth.authorize(
            { providerID: val?.integrationID, method, inputs: val?.inputs },
            { throwOnError: true },
          )
          if (!result.data) throw new Error("Failed to start OAuth authorization")
          return located(
            {
              attemptID: `${val?.integrationID}:${method}`,
              url: result.data.url,
              instructions: result.data.instructions,
              mode: result.data.method,
              time: { created: Date.now(), expires: Date.now() + 10 * 60 * 1000 },
            },
            val?.location,
          )
        },
        complete: async (value: Parameters<ServerApi["integration"]["oauth"]["complete"]>[0]) => {
          const val = value as any
          const method = Number(val?.attemptID?.split(":")?.at(-1))
          await legacy(val?.location).provider.oauth.callback(
            { providerID: val?.integrationID, method, code: val?.code },
            { throwOnError: true },
          )
        },
        status: async (value: Parameters<ServerApi["integration"]["oauth"]["status"]>[0]) => {
          const val = value as any
          const method = Number(val?.attemptID?.split(":")?.at(-1))
          await legacy(val?.location).provider.oauth.callback(
            { providerID: val?.integrationID, method },
            { throwOnError: true },
          )
          return located(
            { status: "complete" as const, time: { created: Date.now(), expires: Date.now() } },
            val?.location,
          )
        },
      },
    },
    pty: {
      ...currentPty,
      async shells(value?: Parameters<ServerApi["pty"]["shells"]>[0]) {
        const val = value as any
        return located((await legacy(val?.location).pty.shells()).data ?? [], val?.location)
      },
      async list(value?: Parameters<ServerApi["pty"]["list"]>[0]) {
        const val = value as any
        return located((await legacy(val?.location).pty.list()).data ?? [], val?.location)
      },
      async create(value?: Parameters<ServerApi["pty"]["create"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).pty.create({
          command: val?.command,
          args: val?.args ? [...val.args] : undefined,
          cwd: val?.cwd,
          title: val?.title,
          env: val?.env,
        })
        if (!result.data) throw new Error("Failed to create terminal")
        return located(result.data, val?.location)
      },
      async get(value: Parameters<ServerApi["pty"]["get"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).pty.get({ ptyID: val?.ptyID })
        if (!result.data) throw new Error(`Terminal not found: ${val?.ptyID}`)
        return located(result.data, val?.location)
      },
      async update(value: Parameters<ServerApi["pty"]["update"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).pty.update({
          ptyID: val?.ptyID,
          title: val?.title,
          size: val?.size,
        })
        if (!result.data) throw new Error(`Terminal not found: ${val?.ptyID}`)
        return located(result.data, val?.location)
      },
      async remove(value: Parameters<ServerApi["pty"]["remove"]>[0]) {
        const val = value as any
        await legacy(val?.location).pty.remove({ ptyID: val?.ptyID })
      },
      async connectToken(value: Parameters<ServerApi["pty"]["connectToken"]>[0]) {
        const val = value as any
        const result = await legacy(val?.location).pty.connectToken({ ptyID: val?.ptyID })
        if (!result.data) throw new Error(`Failed to connect terminal: ${val?.ptyID}`)
        return located(result.data, val?.location)
      },
    },
    permissions: permissionObj,
    permission: permissionObj,
    questions: questionObj,
    question: questionObj,
    commands: commandObj,
    command: commandObj,
    agents: agentObj,
    agent: agentObj,
    references: referenceObj,
    reference: referenceObj,
    providers: providerObj,
    provider: providerObj,
    models: modelObj,
    model: modelObj,
  } as any
}
