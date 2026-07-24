import type { ServerApi } from "./server"
import type { ServerProtocol } from "./server-protocol"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"
import type {
  Project,
  ProjectCurrent,
  SessionApi,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInfo,
  SessionPromptInput,
  SessionPromptOutput,
  SessionShellInput,
  SessionShellOutput,
} from "@opencode-ai/client/promise"

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
  rename: (input: Parameters<SessionApi["rename"]>[0] & LegacyLocation) => ReturnType<SessionApi["rename"]>
  archive: (input: Parameters<SessionApi["archive"]>[0] & LegacyLocation) => ReturnType<SessionApi["archive"]>
  remove: (input: Parameters<SessionApi["remove"]>[0] & LegacyLocation) => ReturnType<SessionApi["remove"]>
}
type CompatiblePermissionApi = Omit<ServerApi["permission"], "reply"> & {
  reply: (
    input: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } },
  ) => ReturnType<ServerApi["permission"]["reply"]>
}
export type CompatibleApi = Omit<ServerApi, "session" | "permission"> & {
  readonly session: CompatibleSessionApi
  readonly permission: CompatiblePermissionApi
}
type LegacyPrompt = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
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
  return lazyApi(
    input.protocol.then((protocol) => (protocol === "v1" ? v1 : input.current)),
    input.current,
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

  return {
    ...input.current,
    session: {
      ...input.current.session,
      async list(
        value?: Parameters<ServerApi["session"]["list"]>[0],
        options?: Parameters<ServerApi["session"]["list"]>[1],
      ) {
        if (!value?.directory && value?.search !== undefined) {
          const result = await legacy().experimental.session.list(
            {
              roots: value.parentID === null ? true : undefined,
              search: value.search,
              limit: value.limit,
            },
            options,
          )
          return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
        }
        const result = await legacy({ directory: value?.directory }).session.list({
          directory: value?.directory,
          roots: value?.parentID === null ? true : undefined,
          search: value?.search,
          limit: value?.limit,
        })
        return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
      },
      async create(value?: Parameters<ServerApi["session"]["create"]>[0]) {
        const result = await legacy(value?.location ?? undefined).session.create({
          directory: directory(value?.location ?? undefined),
        })
        if (!result.data) throw new Error("Failed to create session")
        return sessionInfo(result.data)
      },
      async get(value: Parameters<ServerApi["session"]["get"]>[0]) {
        const result = await legacy().session.get(value)
        if (!result.data) throw new Error(`Session not found: ${value.sessionID}`)
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
      async rename(value: Parameters<ServerApi["session"]["rename"]>[0] & LegacyLocation) {
        await legacy(value).session.update({ sessionID: value.sessionID, title: value.title })
      },
      async archive(value: Parameters<ServerApi["session"]["archive"]>[0] & LegacyLocation) {
        await legacy(value).session.update({ sessionID: value.sessionID, time: { archived: Date.now() } })
      },
      async remove(value: Parameters<ServerApi["session"]["remove"]>[0] & LegacyLocation) {
        await legacy(value).session.delete(value)
      },
      async fork(value: Parameters<ServerApi["session"]["fork"]>[0]) {
        const result = await legacy().session.fork(value)
        if (!result.data) throw new Error("Failed to fork session")
        return sessionInfo(result.data)
      },
      async interrupt(value: Parameters<ServerApi["session"]["interrupt"]>[0]) {
        await legacy().session.abort(value)
      },
      async prompt(value: SessionPromptInput & LegacyPrompt) {
        await legacy().session.promptAsync({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          agent: value.agent,
          model: value.model,
          variant: value.variant,
          parts: [
            { type: "text", text: value.text },
            ...(value.files ?? []).map((file) => ({
              type: "file" as const,
              mime: mime(file.uri),
              url: file.uri,
              filename: file.name,
            })),
            ...(value.agents ?? []).map((agent) => ({
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
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: value.text },
          delivery: value.delivery ?? "steer",
        }
      },
      async command(value: SessionCommandInput) {
        await legacy().session.command({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          command: value.command,
          arguments: value.arguments ?? "",
          agent: value.agent ?? undefined,
          model: value.model ? `${value.model.providerID}/${value.model.id}` : undefined,
          variant: value.model?.variant,
          parts: value.files?.map((file) => ({
            type: "file" as const,
            mime: mime(file.uri),
            url: file.uri,
            filename: file.name,
          })),
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: `/${value.command} ${value.arguments ?? ""}`.trim() },
          delivery: value.delivery ?? "steer",
        }
      },
      async shell(value: SessionShellInput & LegacyPrompt) {
        await legacy().session.shell({
          sessionID: value.sessionID,
          command: value.command,
          agent: value.agent,
          model: value.model,
        })
      },
      compact: async (value: SessionCompactInput & { model?: LegacyPrompt["model"] }) => {
        if (!value.model) throw new Error("A model is required to compact a V1 session")
        await legacy().session.summarize({
          sessionID: value.sessionID,
          providerID: value.model.providerID,
          modelID: value.model.modelID,
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "compaction",
        }
      },
      revert: {
        stage: async (value: Parameters<ServerApi["session"]["revert"]["stage"]>[0]) => {
          await legacy().session.revert(value)
          return { messageID: value.messageID }
        },
        clear: async (value: Parameters<ServerApi["session"]["revert"]["clear"]>[0]) => {
          await legacy().session.unrevert(value)
        },
        commit: input.current.session.revert.commit,
      },
    },
    project: {
      ...input.current.project,
      async list() {
        return ((await legacy().project.list()).data ?? []) as Project[]
      },
      async current(value?: Parameters<ServerApi["project"]["current"]>[0]) {
        const result = await legacy(value?.location).project.current()
        if (!result.data) throw new Error("Project not found")
        return { id: result.data.id, directory: result.data.worktree } satisfies ProjectCurrent
      },
      async update(value: Parameters<ServerApi["project"]["update"]>[0]) {
        const project = (await legacy().project.list()).data?.find((item) => item.id === value.projectID)
        const result = await legacy({ directory: project?.worktree }).project.update({
          ...value,
          directory: project?.worktree,
        })
        if (!result.data) throw new Error(`Project not found: ${value.projectID}`)
        return result.data as Project
      },
      async directories(value: Parameters<ServerApi["project"]["directories"]>[0]) {
        const result = await legacy(value.location).worktree.list()
        return (result.data ?? []).map((item) => ({ directory: item }))
      },
    },
    path: {
      ...input.current.path,
      async get(value?: Parameters<ServerApi["path"]["get"]>[0]) {
        const result = await legacy(value?.location).path.get()
        if (!result.data) throw new Error("Path unavailable")
        return result.data
      },
    },
    vcs: {
      ...input.current.vcs,
      async get(value?: Parameters<ServerApi["vcs"]["get"]>[0]) {
        const result = await legacy(value?.location).vcs.get()
        return located({ branch: result.data?.branch, defaultBranch: result.data?.default_branch }, value?.location)
      },
      async status(value?: Parameters<ServerApi["vcs"]["status"]>[0]) {
        const result = await legacy(value?.location).vcs.status()
        return located(result.data ?? [], value?.location)
      },
      async diff(value: Parameters<ServerApi["vcs"]["diff"]>[0]) {
        const result = await legacy(value.location).vcs.diff({
          mode: value.mode === "working" ? "git" : value.mode,
          context: value.context,
        })
        return located(
          (result.data ?? []).map((file) => ({
            file: file.file,
            patch: file.patch ?? "",
            additions: file.additions,
            deletions: file.deletions,
            status: file.status ?? "modified",
          })),
          value.location,
        )
      },
    },
    file: {
      ...input.current.file,
      async list(value?: Parameters<ServerApi["file"]["list"]>[0]) {
        const result = await legacy(value?.location).file.list({ path: value?.path ?? "" })
        return located(result.data ?? [], value?.location)
      },
      async find(value: Parameters<ServerApi["file"]["find"]>[0]) {
        const result = await legacy(value.location).find.files({
          query: value.query,
          dirs: value.type === undefined ? undefined : value.type === "directory" ? "true" : "false",
          limit: value.limit,
        })
        return located(
          (result.data ?? []).map((path) => ({ path, type: value.type ?? "file" })),
          value.location,
        )
      },
    },
    integration: {
      ...input.current.integration,
      async get(value: Parameters<ServerApi["integration"]["get"]>[0]) {
        const methods = ((await legacy(value.location).provider.auth()).data?.[value.integrationID] ?? []).map(
          (method, index) =>
            method.type === "api"
              ? { type: "key" as const, label: method.label }
              : { type: "oauth" as const, id: String(index), label: method.label, prompts: method.prompts },
        )
        return located(
          {
            id: value.integrationID,
            name: value.integrationID,
            methods,
            connections: [],
          },
          value.location,
        )
      },
      connect: {
        ...input.current.integration.connect,
        key: async (value: Parameters<ServerApi["integration"]["connect"]["key"]>[0]) => {
          await legacy(value.location).auth.set({
            providerID: value.integrationID,
            auth: { type: "api", key: value.key },
          })
        },
      },
      oauth: {
        ...input.current.integration.oauth,
        connect: async (value: Parameters<ServerApi["integration"]["oauth"]["connect"]>[0]) => {
          const method = Number(value.methodID)
          const result = await legacy(value.location).provider.oauth.authorize(
            { providerID: value.integrationID, method, inputs: value.inputs },
            { throwOnError: true },
          )
          if (!result.data) throw new Error("Failed to start OAuth authorization")
          return located(
            {
              attemptID: `${value.integrationID}:${method}`,
              url: result.data.url,
              instructions: result.data.instructions,
              mode: result.data.method,
              time: { created: Date.now(), expires: Date.now() + 10 * 60 * 1000 },
            },
            value.location,
          )
        },
        complete: async (value: Parameters<ServerApi["integration"]["oauth"]["complete"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method, code: value.code },
            { throwOnError: true },
          )
        },
        status: async (value: Parameters<ServerApi["integration"]["oauth"]["status"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method },
            { throwOnError: true },
          )
          return located(
            { status: "complete" as const, time: { created: Date.now(), expires: Date.now() } },
            value.location,
          )
        },
      },
    },
    pty: {
      ...input.current.pty,
      async shells(value?: Parameters<ServerApi["pty"]["shells"]>[0]) {
        return located((await legacy(value?.location).pty.shells()).data ?? [], value?.location)
      },
      async list(value?: Parameters<ServerApi["pty"]["list"]>[0]) {
        return located((await legacy(value?.location).pty.list()).data ?? [], value?.location)
      },
      async create(value?: Parameters<ServerApi["pty"]["create"]>[0]) {
        const result = await legacy(value?.location).pty.create({
          command: value?.command,
          args: value?.args ? [...value.args] : undefined,
          cwd: value?.cwd,
          title: value?.title,
          env: value?.env,
        })
        if (!result.data) throw new Error("Failed to create terminal")
        return located(result.data, value?.location)
      },
      async get(value: Parameters<ServerApi["pty"]["get"]>[0]) {
        const result = await legacy(value.location).pty.get({ ptyID: value.ptyID })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async update(value: Parameters<ServerApi["pty"]["update"]>[0]) {
        const result = await legacy(value.location).pty.update({
          ptyID: value.ptyID,
          title: value.title,
          size: value.size,
        })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async remove(value: Parameters<ServerApi["pty"]["remove"]>[0]) {
        await legacy(value.location).pty.remove({ ptyID: value.ptyID })
      },
      async connectToken(value: Parameters<ServerApi["pty"]["connectToken"]>[0]) {
        const result = await legacy(value.location).pty.connectToken({ ptyID: value.ptyID })
        if (!result.data) throw new Error(`Failed to connect terminal: ${value.ptyID}`)
        return located(result.data, value.location)
      },
    },
    permission: {
      ...input.current.permission,
      async reply(
        value: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } },
      ) {
        await legacy(value.location).permission.respond({
          sessionID: value.sessionID,
          permissionID: value.requestID,
          response: value.reply,
          directory: directory(value.location),
        })
      },
    },
    question: {
      ...input.current.question,
      async reply(value: Parameters<ServerApi["question"]["reply"]>[0]) {
        await legacy().question.reply({
          requestID: value.requestID,
          answers: value.answers.map((answer) => [...answer]),
        })
      },
      async reject(value: Parameters<ServerApi["question"]["reject"]>[0]) {
        await legacy().question.reject({ requestID: value.requestID })
      },
    },
  }
}
