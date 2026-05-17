import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { WebDriver } from "selenium-webdriver"
import { createSdk, serverUrl } from "./utils"

async function poll<T>(input: {
  probe: () => Promise<T>
  timeout?: number
  interval?: number
  ok: (v: T) => boolean
}) {
  const timeout = input.timeout ?? 30_000
  const interval = input.interval ?? 250
  const end = Date.now() + timeout
  let last: T | undefined
  while (Date.now() < end) {
    last = await input.probe()
    if (input.ok(last)) return last
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`poll timed out after ${timeout}ms`)
}

/** Stateless architecture: seed project storage before navigating (WebDriver). */
export async function seedProjectsWebDriver(driver: WebDriver, input: { projectId: string }) {
  const directory = input.projectId
  await driver.executeScript(
    `(() => {
      const args = arguments[0]
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      let parsed
      try {
        parsed = raw ? JSON.parse(raw) : undefined
      } catch {
        parsed = undefined
      }
      const store = parsed && typeof parsed === "object" ? parsed : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject = store.lastProject && typeof store.lastProject === "object" ? store.lastProject : {}
      const nextLast = { ...lastProject }
      nextLast.local = args.directory
      nextLast[args.serverUrl] = args.directory
      localStorage.setItem(key, JSON.stringify({ list, lastProject: nextLast }))
    })()`,
    { directory, serverUrl: serverUrl() },
  )
}

export async function createTestProject(name = "E2E Test Project") {
  const sdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
  const result = await sdk.project.create({ name })
  if (!result.data?.project?.id) throw new Error("Failed to create test project")

  return `/projects/${result.data.project.id}`
}

export async function cleanupTestProject(_directory: string) {}

export function slugFromUrl(url: string) {
  const m = /\/([^/]+)\/session(?:[/?#]|$)/.exec(url)
  return m ? m[1] : ""
}

export function sessionIDFromUrl(url: string) {
  const match = /\/session\/([^/?#]+)/.exec(url)
  return match ? match[1] : undefined
}

async function status(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  const raw = await sdk.session.status().catch(() => undefined)
  const data = raw?.data
  if (!data) return undefined
  return data[sessionID]
}

async function stable(sdk: ReturnType<typeof createSdk>, sessionID: string, timeout = 10_000) {
  let prev = ""
  await poll({
    timeout,
    ok: (ready) => ready === true,
    probe: async () => {
      const info = await sdk.session
        .get({ sessionID })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!info) return true
      const u = info.time.updated
      const c = info.time.created
      const next = `${info.title}:${u !== undefined ? u : c}`
      if (next !== prev) {
        prev = next
        return false
      }
      return true
    },
  })
}

export async function waitSessionIdle(sdk: ReturnType<typeof createSdk>, sessionID: string, timeout = 30_000) {
  await poll({
    timeout,
    ok: (v) => v === true,
    probe: async () => {
      const s = await status(sdk, sessionID)
      if (!s) return true
      return s.type === "idle"
    },
  })
}

export async function cleanupSession(input: { sessionID: string; sdk: ReturnType<typeof createSdk> }) {
  const sdk = input.sdk
  await waitSessionIdle(sdk, input.sessionID, 5_000).catch(() => undefined)
  const current = await status(sdk, input.sessionID).catch(() => undefined)
  if (current && current.type !== "idle") {
    await sdk.session.abort({ sessionID: input.sessionID }).catch(() => undefined)
    await waitSessionIdle(sdk, input.sessionID).catch(() => undefined)
  }
  await stable(sdk, input.sessionID).catch(() => undefined)
  await sdk.session.delete({ sessionID: input.sessionID }).catch(() => undefined)
}

export async function withSession<T>(
  sdk: ReturnType<typeof createSdk>,
  title: string,
  callback: (session: { id: string; title: string }) => Promise<T>,
): Promise<T> {
  const session = await sdk.session.create({ title }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  try {
    return await callback(session)
  } finally {
    await cleanupSession({ sdk, sessionID: session.id })
  }
}

const seedSystem = [
  "You are seeding deterministic e2e UI state.",
  "Follow the user's instruction exactly.",
  "When asked to call a tool, call exactly that tool exactly once with the exact JSON input.",
  "Do not call any extra tools.",
].join(" ")

const wait = async <T>(input: { probe: () => Promise<T | undefined>; timeout?: number }) => {
  const timeout = input.timeout ?? 30_000
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await input.probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const seed = async <T>(input: {
  sessionID: string
  prompt: string
  sdk: ReturnType<typeof createSdk>
  probe: () => Promise<T | undefined>
  timeout?: number
  attempts?: number
}) => {
  for (let i = 0; i < (input.attempts ?? 2); i++) {
    await input.sdk.session.promptAsync({
      sessionID: input.sessionID,
      agent: "build",
      system: seedSystem,
      parts: [{ type: "text", text: input.prompt }],
    })
    const value = await wait({ probe: input.probe, timeout: input.timeout })
    if (value !== undefined) return value
  }
}

export async function seedSessionQuestion(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    questions: Array<{
      header: string
      question: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
  },
) {
  const first = input.questions[0]
  if (!first) throw new Error("Question seed requires at least one question")

  const text = [
    "Your only valid response is one question tool call.",
    `Use this JSON input: ${JSON.stringify({ questions: input.questions })}`,
    "Do not output plain text.",
    "After calling the tool, wait for the user response.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const rows = await sdk.question.list().then((x) => x.data ?? [])
      return rows.find((item) => item.sessionID === input.sessionID && item.questions[0]?.header === first.header)
    },
  })

  if (!result) throw new Error("Timed out seeding question request")
  return { id: result.id }
}

export async function seedSessionPermission(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    permission: string
    patterns: string[]
    description?: string
  },
) {
  const text = [
    "Your only valid response is one bash tool call.",
    `Use this JSON input: ${JSON.stringify({
      command: input.patterns[0] ? `ls ${JSON.stringify(input.patterns[0])}` : "pwd",
      workdir: "/",
      description: input.description ? input.description : `seed ${input.permission} permission request`,
    })}`,
    "Do not output plain text.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const rows = await sdk.permission.list().then((x) => x.data ?? [])
      return rows.find((item) => item.sessionID === input.sessionID)
    },
  })

  if (!result) throw new Error("Timed out seeding permission request")
  return { id: result.id }
}

export async function seedSessionTask(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    description: string
    prompt: string
    subagentType?: string
  },
) {
  const text = [
    "Your only valid response is one task tool call.",
    `Use this JSON input: ${JSON.stringify({
      description: input.description,
      prompt: input.prompt,
      subagent_type: input.subagentType ? input.subagentType : "general",
    })}`,
    "Do not output plain text.",
    "Wait for the task to start and return the child session id.",
  ].join("\n")

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 90_000,
    probe: async () => {
      const messages = await sdk.session.messages({ sessionID: input.sessionID, limit: 50 }).then((x) => x.data ?? [])
      const part = messages
        .flatMap((message) => message.parts)
        .find((p) => {
          if (p.type !== "tool" || p.tool !== "task") return false
          if (p.state.status === "pending") return false
          if (p.state.input?.description !== input.description) return false
          const sid = p.state.metadata?.sessionId
          return typeof sid === "string" && sid.length > 0
        })

      if (!part || part.type !== "tool") return undefined
      if (part.state.status === "pending") return undefined
      const id = part.state.metadata?.sessionId
      if (typeof id !== "string" || !id) return undefined
      const child = await sdk.session
        .get({ sessionID: id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!child?.id) return undefined
      return { sessionID: id }
    },
  })

  if (!result) throw new Error("Timed out seeding task tool")
  return result
}

export async function seedSessionTodos(
  sdk: ReturnType<typeof createSdk>,
  input: {
    sessionID: string
    todos: Array<{ content: string; status: string; priority: string }>
  },
) {
  const text = [
    "Your only valid response is one todowrite tool call.",
    `Use this JSON input: ${JSON.stringify({ todos: input.todos })}`,
    "Do not output plain text.",
  ].join("\n")
  const target = JSON.stringify(input.todos)

  const result = await seed({
    sdk,
    sessionID: input.sessionID,
    prompt: text,
    timeout: 30_000,
    probe: async () => {
      const todos = await sdk.session.todo({ sessionID: input.sessionID }).then((x) => x.data ?? [])
      if (JSON.stringify(todos) !== target) return undefined
      return true
    },
  })

  if (!result) throw new Error("Timed out seeding todos")
  return true
}

export async function clearSessionDockSeed(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  const [questions, permissions] = await Promise.all([
    sdk.question.list().then((x) => x.data ?? []),
    sdk.permission.list().then((x) => x.data ?? []),
  ])

  await Promise.all([
    ...questions
      .filter((item) => item.sessionID === sessionID)
      .map((item) => sdk.question.reject({ requestID: item.id }).catch(() => undefined)),
    ...permissions
      .filter((item) => item.sessionID === sessionID)
      .map((item) => sdk.permission.reply({ requestID: item.id, reply: "reject" }).catch(() => undefined)),
  ])

  return true
}
