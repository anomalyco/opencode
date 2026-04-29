import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session as SessionNs } from "@/session/session"
import { TestLLMServer } from "../lib/llm-server"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}
type Backend = "legacy" | "httpapi"
type Sdk = ReturnType<typeof createOpencodeClient>
type SdkResult = { response: Response; data?: unknown; error?: unknown }

function app(backend: Backend, input?: { password?: string; username?: string }) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = backend === "httpapi"
  Flag.OPENCODE_SERVER_PASSWORD = input?.password
  Flag.OPENCODE_SERVER_USERNAME = input?.username
  return backend === "httpapi" ? Server.Default().app : Server.Legacy().app
}

function client(
  backend: Backend,
  directory?: string,
  input?: { password?: string; username?: string; headers?: Record<string, string> },
) {
  const serverApp = app(backend, input)
  const fetch = Object.assign(
    async (request: RequestInfo | URL, init?: RequestInit) =>
      await serverApp.fetch(request instanceof Request ? request : new Request(request, init)),
    { preconnect: globalThis.fetch.preconnect },
  ) satisfies typeof globalThis.fetch
  return createOpencodeClient({
    baseUrl: "http://localhost",
    directory,
    headers: input?.headers,
    fetch,
  })
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function providerConfig(url: string) {
  return {
    formatter: false,
    lsp: false,
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

async function expectStatus(result: Promise<{ response: Response }>, status: number) {
  expect((await result).response.status).toBe(status)
}

async function capture(result: Promise<SdkResult>) {
  const response = await result
  return {
    status: response.response.status,
    data: response.data,
    error: response.error,
  }
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function statuses(input: Record<string, Awaited<ReturnType<typeof capture>>>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.status]))
}

function firstPartText(value: unknown) {
  return record(array(record(value).parts)[0]).text
}

function sessionTitles(value: unknown) {
  return array(value)
    .map((item) => record(item).title)
    .filter((title): title is string => typeof title === "string")
    .sort()
}

async function runSession<A, E>(directory: string, effect: Effect.Effect<A, E, SessionNs.Service>) {
  return Instance.provide({
    directory,
    fn: () => Effect.runPromise(effect.pipe(Effect.provide(SessionNs.defaultLayer))),
  })
}

async function seedMessage(directory: string, sessionID: string) {
  const id = SessionID.make(sessionID)
  return runSession(
    directory,
    SessionNs.Service.use((svc) =>
      Effect.gen(function* () {
        const message = yield* svc.updateMessage({
          id: MessageID.ascending(),
          sessionID: id,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        const part = yield* svc.updatePart({
          id: PartID.ascending(),
          sessionID: id,
          messageID: message.id,
          type: "text",
          text: "seeded message",
        })
        return { message, part }
      }),
    ),
  )
}

async function compareBackends<T>(scenario: (backend: Backend) => Promise<T>) {
  const legacy = await scenario("legacy")
  await Instance.disposeAll()
  await resetDatabase()
  const httpapi = await scenario("httpapi")
  expect(httpapi).toEqual(legacy)
}

async function withTmp<T>(backend: Backend, fn: (input: { sdk: Sdk; directory: string }) => Promise<T>) {
  await using tmp = await tmpdir({
    git: true,
    config: { formatter: false, lsp: false },
    init: async (dir) => {
      await Bun.write(path.join(dir, "hello.txt"), "hello")
      await Bun.write(path.join(dir, "needle.ts"), "export const needle = 'sdk-parity'\n")
    },
  })
  return fn({ sdk: client(backend, tmp.path), directory: tmp.path })
}

async function withFakeLlm<T>(
  backend: Backend,
  fn: (input: { sdk: Sdk; directory: string; llm: TestLLMServer["Service"] }) => Promise<T>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: providerConfig(llm.url) })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      return yield* Effect.promise(() => fn({ sdk: client(backend, tmp.path), directory: tmp.path, llm }))
    }).pipe(Effect.scoped, Effect.provide(TestLLMServer.layer)),
  )
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi SDK", () => {
  test("uses the generated SDK for global and control routes", async () => {
    const sdk = client("httpapi")
    const health = await sdk.global.health()

    expect(health.response.status).toBe(200)
    expect(health.data).toMatchObject({ healthy: true })

    const events = await sdk.global.event({ signal: AbortSignal.timeout(1_000) })
    try {
      const first = await events.stream.next()
      expect(first.value).toMatchObject({ payload: { type: "server.connected" } })
    } finally {
      await events.stream.return(undefined)
    }

    const log = await sdk.app.log({ service: "httpapi-sdk-test", level: "info", message: "hello" })
    expect(log.response.status).toBe(200)
    expect(log.data).toBe(true)

    await expectStatus(sdk.auth.set({ providerID: "test" }), 400)
  })

  test("uses the generated SDK for safe instance routes", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false },
      init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello"),
    })
    const sdk = client("httpapi", tmp.path)

    const file = await sdk.file.read({ path: "hello.txt" })
    expect(file.response.status).toBe(200)
    expect(file.data).toMatchObject({ content: "hello" })

    const session = await sdk.session.create({ title: "sdk" })
    expect(session.response.status).toBe(200)
    expect(session.data).toMatchObject({ title: "sdk" })

    const listed = await sdk.session.list({ roots: true, limit: 10 })
    expect(listed.response.status).toBe(200)
    expect(listed.data?.map((item) => item.id)).toContain(session.data?.id)

    await Promise.all([
      expectStatus(sdk.project.current(), 200),
      expectStatus(sdk.config.get(), 200),
      expectStatus(sdk.config.providers(), 200),
      expectStatus(sdk.find.files({ query: "hello", limit: 10 }), 200),
    ])
  })

  test("matches generated SDK global and control behavior across backends", async () => {
    await compareBackends(async (backend) => {
      const sdk = client(backend)
      const health = await capture(sdk.global.health())
      const log = await capture(sdk.app.log({ service: "sdk-parity", level: "info", message: "hello" }))
      const invalidAuth = await capture(sdk.auth.set({ providerID: "test" }))

      return {
        statuses: statuses({ health, log, invalidAuth }),
        health: record(health.data).healthy,
        log: log.data,
      }
    })
  })

  test("matches generated SDK global event stream across backends", async () => {
    await compareBackends(async (backend) => {
      const events = await client(backend).global.event({ signal: AbortSignal.timeout(1_000) })
      try {
        const first = await events.stream.next()
        return {
          type: record(record(first.value).payload).type,
        }
      } finally {
        await events.stream.return(undefined)
      }
    })
  })

  test("matches generated SDK instance event stream across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk }) => {
        const events = await sdk.event.subscribe(undefined, { signal: AbortSignal.timeout(1_000) })
        try {
          const first = await events.stream.next()
          return {
            type: record(record(first.value).payload).type,
          }
        } finally {
          await events.stream.return(undefined)
        }
      }),
    )
  })

  test("matches generated SDK basic auth behavior across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ directory }) => {
        const missing = await capture(
          client(backend, directory, { password: "secret" }).file.read({ path: "hello.txt" }),
        )
        const bad = await capture(
          client(backend, directory, {
            password: "secret",
            headers: { authorization: authorization("opencode", "wrong") },
          }).file.read({ path: "hello.txt" }),
        )
        const good = await capture(
          client(backend, directory, {
            password: "secret",
            headers: { authorization: authorization("opencode", "secret") },
          }).file.read({ path: "hello.txt" }),
        )

        return {
          statuses: statuses({ missing, bad, good }),
          content: record(good.data).content,
        }
      }),
    )
  })

  test("matches generated SDK instance read routes across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk, directory }) => {
        const project = await capture(sdk.project.current())
        const projects = await capture(sdk.project.list())
        const paths = await capture(sdk.path.get())
        const config = await capture(sdk.config.get())
        const providers = await capture(sdk.config.providers())
        const file = await capture(sdk.file.read({ path: "hello.txt" }))
        const files = await capture(sdk.file.list({ path: "." }))
        const fileStatus = await capture(sdk.file.status())
        const findFiles = await capture(sdk.find.files({ query: "hello", limit: 10 }))
        const findText = await capture(sdk.find.text({ pattern: "sdk-parity" }))
        const agents = await capture(sdk.app.agents())
        const skills = await capture(sdk.app.skills())
        const tools = await capture(sdk.tool.ids())
        const vcs = await capture(sdk.vcs.get())
        const formatter = await capture(sdk.formatter.status())
        const lsp = await capture(sdk.lsp.status())

        return {
          statuses: statuses({
            project,
            projects,
            paths,
            config,
            providers,
            file,
            files,
            fileStatus,
            findFiles,
            findText,
            agents,
            skills,
            tools,
            vcs,
            formatter,
            lsp,
          }),
          project: {
            worktreeSelected: record(project.data).worktree === directory,
          },
          paths: {
            cwdSelected: record(paths.data).cwd === directory,
          },
          file: record(file.data).content,
          hasProject: array(projects.data).length > 0,
          foundFile: JSON.stringify(findFiles.data).includes("hello.txt"),
          foundText: JSON.stringify(findText.data ?? null).includes("sdk-parity"),
          listedFile: JSON.stringify(files.data).includes("hello.txt"),
        }
      }),
    )
  })

  test("matches generated SDK session lifecycle routes across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk }) => {
        const parent = await capture(sdk.session.create({ title: "parent" }))
        const parentID = String(record(parent.data).id)
        const child = await capture(sdk.session.create({ title: "child", parentID }))
        const childID = String(record(child.data).id)
        const get = await capture(sdk.session.get({ sessionID: parentID }))
        const update = await capture(sdk.session.update({ sessionID: parentID, title: "renamed" }))
        const roots = await capture(sdk.session.list({ roots: true, limit: 10 }))
        const all = await capture(sdk.session.list({ roots: false, limit: 10 }))
        const children = await capture(sdk.session.children({ sessionID: parentID }))
        const todo = await capture(sdk.session.todo({ sessionID: parentID }))
        const status = await capture(sdk.session.status())
        const messages = await capture(sdk.session.messages({ sessionID: parentID }))
        const missingGet = await capture(sdk.session.get({ sessionID: "ses_missing" }))
        const missingMessages = await capture(sdk.session.messages({ sessionID: "ses_missing", limit: 2 }))
        const invalidCursor = await capture(sdk.session.messages({ sessionID: parentID, limit: 2, before: "bad" }))
        const deleted = await capture(sdk.session.delete({ sessionID: childID }))
        const getDeleted = await capture(sdk.session.get({ sessionID: childID }))

        return {
          statuses: statuses({
            parent,
            child,
            get,
            update,
            roots,
            all,
            children,
            todo,
            status,
            messages,
            missingGet,
            missingMessages,
            invalidCursor,
            deleted,
            getDeleted,
          }),
          getTitle: record(get.data).title,
          updatedTitle: record(update.data).title,
          rootTitles: sessionTitles(roots.data),
          allTitles: sessionTitles(all.data),
          childCount: array(children.data).length,
          todoCount: array(todo.data).length,
          messageCount: array(messages.data).length,
        }
      }),
    )
  })

  test("matches generated SDK session message and part routes across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk, directory }) => {
        const session = await capture(sdk.session.create({ title: "messages" }))
        const sessionID = String(record(session.data).id)
        const seeded = await seedMessage(directory, sessionID)
        const list = await capture(sdk.session.messages({ sessionID }))
        const page = await capture(sdk.session.messages({ sessionID, limit: 1 }))
        const message = await capture(sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const partUpdate = await capture(
          sdk.part.update({
            sessionID,
            messageID: seeded.message.id,
            partID: seeded.part.id,
            part: {
              ...seeded.part,
              text: "updated message",
            } as NonNullable<Parameters<Sdk["part"]["update"]>[0]["part"]>,
          }),
        )
        const updated = await capture(sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const partDelete = await capture(
          sdk.part.delete({ sessionID, messageID: seeded.message.id, partID: seeded.part.id }),
        )
        const withoutPart = await capture(sdk.session.message({ sessionID, messageID: seeded.message.id }))
        const deleteMessage = await capture(sdk.session.deleteMessage({ sessionID, messageID: seeded.message.id }))
        const missingMessage = await capture(sdk.session.message({ sessionID, messageID: seeded.message.id }))

        return {
          statuses: statuses({
            session,
            list,
            page,
            message,
            partUpdate,
            updated,
            partDelete,
            withoutPart,
            deleteMessage,
            missingMessage,
          }),
          listCount: array(list.data).length,
          pageCount: array(page.data).length,
          initialText: firstPartText(message.data),
          updatedText: firstPartText(updated.data),
          partCountAfterDelete: array(record(withoutPart.data).parts).length,
        }
      }),
    )
  })

  test("matches generated SDK prompt no-reply routes across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk }) => {
        const session = await capture(sdk.session.create({ title: "prompt" }))
        const sessionID = String(record(session.data).id)
        const prompt = await capture(
          sdk.session.prompt({
            sessionID,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          }),
        )
        const asyncPrompt = await capture(
          sdk.session.promptAsync({
            sessionID,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "async hello" }],
          }),
        )
        const messages = await capture(sdk.session.messages({ sessionID }))

        return {
          statuses: statuses({ session, prompt, asyncPrompt, messages }),
          promptRole: record(record(prompt.data).info).role,
          messageCount: array(messages.data).length,
          messageTexts: array(messages.data)
            .flatMap((item) => array(record(item).parts))
            .map((part) => record(part).text)
            .filter((text): text is string => typeof text === "string")
            .sort(),
        }
      }),
    )
  })

  test("matches generated SDK prompt streaming through fake LLM across backends", async () => {
    await compareBackends((backend) =>
      withFakeLlm(backend, async ({ sdk, llm }) => {
        await Effect.runPromise(llm.text("fake world", { usage: { input: 11, output: 7 } }))
        const session = await capture(
          sdk.session.create({
            title: "llm prompt",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          }),
        )
        const sessionID = String(record(session.data).id)
        const prompt = await capture(
          sdk.session.prompt({
            sessionID,
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "hello llm" }],
          }),
        )
        const messages = await capture(sdk.session.messages({ sessionID }))
        const inputs = await Effect.runPromise(llm.inputs)

        return {
          statuses: statuses({ session, prompt, messages }),
          calls: inputs.length,
          requestedModel: inputs[0]?.model,
          responseText: JSON.stringify(prompt.data).includes("fake world"),
          persistedText: JSON.stringify(messages.data).includes("fake world"),
          userText: JSON.stringify(messages.data).includes("hello llm"),
        }
      }),
    )
  })

  test("matches generated SDK TUI validation and command routes across backends", async () => {
    await compareBackends((backend) =>
      withTmp(backend, async ({ sdk }) => {
        const session = await capture(sdk.session.create({ title: "tui" }))
        const sessionID = String(record(session.data).id)
        const appendPrompt = await capture(sdk.tui.appendPrompt({ text: "hello" }))
        const openHelp = await capture(sdk.tui.openHelp())
        const openSessions = await capture(sdk.tui.openSessions())
        const openThemes = await capture(sdk.tui.openThemes())
        const openModels = await capture(sdk.tui.openModels())
        const submitPrompt = await capture(sdk.tui.submitPrompt())
        const clearPrompt = await capture(sdk.tui.clearPrompt())
        const executeCommand = await capture(sdk.tui.executeCommand({ command: "session_new" }))
        const showToast = await capture(sdk.tui.showToast({ title: "SDK", message: "hello", variant: "info" }))
        const selectSession = await capture(sdk.tui.selectSession({ sessionID }))
        const missingSession = await capture(sdk.tui.selectSession({ sessionID: "ses_missing" }))
        const invalidSession = await capture(sdk.tui.selectSession({ sessionID: "invalid_session_id" }))

        return {
          statuses: statuses({
            session,
            appendPrompt,
            openHelp,
            openSessions,
            openThemes,
            openModels,
            submitPrompt,
            clearPrompt,
            executeCommand,
            showToast,
            selectSession,
            missingSession,
            invalidSession,
          }),
          data: {
            appendPrompt: appendPrompt.data,
            openHelp: openHelp.data,
            openSessions: openSessions.data,
            openThemes: openThemes.data,
            openModels: openModels.data,
            submitPrompt: submitPrompt.data,
            clearPrompt: clearPrompt.data,
            executeCommand: executeCommand.data,
            showToast: showToast.data,
            selectSession: selectSession.data,
          },
        }
      }),
    )
  })

  test("matches generated SDK project git initialization across backends", async () => {
    await compareBackends(async (backend) => {
      await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
      const sdk = client(backend, tmp.path)
      const before = await capture(sdk.project.current())
      const init = await capture(sdk.project.initGit())
      const after = await capture(sdk.project.current())

      return {
        statuses: statuses({ before, init, after }),
        before: {
          vcs: record(before.data).vcs ?? null,
          worktree: record(before.data).worktree,
        },
        init: {
          vcs: record(init.data).vcs,
          worktreeSelected: record(init.data).worktree === tmp.path,
        },
        after: {
          vcs: record(after.data).vcs,
          worktreeSelected: record(after.data).worktree === tmp.path,
        },
      }
    })
  })
})
