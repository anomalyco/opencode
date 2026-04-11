import { test as base, expect, type Page } from "@playwright/test"
import { ManagedRuntime } from "effect"
import type { E2EWindow } from "../src/testing/terminal"
import type { Item, Reply, Usage } from "../../opencode/test/lib/llm-server"
import { TestLLMServer } from "../../opencode/test/lib/llm-server"
import { startBackend } from "./backend"
import {
  healthPhase,
  cleanupSession,
  cleanupTestProject,
  createTestProject,
  setHealthPhase,
  sessionIDFromUrl,
  waitSession,
  waitSessionIdle,
  waitSessionSaved,
  waitSlug,
} from "./actions"
import { promptSelector } from "./selectors"
import { createSdk, dirSlug, getWorktree, serverUrl, sessionPath } from "./utils"

type LLMFixture = {
  url: string
  push: (...input: (Item | Reply)[]) => Promise<void>
  pushMatch: (
    match: (hit: { url: URL; body: Record<string, unknown> }) => boolean,
    ...input: (Item | Reply)[]
  ) => Promise<void>
  textMatch: (
    match: (hit: { url: URL; body: Record<string, unknown> }) => boolean,
    value: string,
    opts?: { usage?: Usage },
  ) => Promise<void>
  toolMatch: (
    match: (hit: { url: URL; body: Record<string, unknown> }) => boolean,
    name: string,
    input: unknown,
  ) => Promise<void>
  text: (value: string, opts?: { usage?: Usage }) => Promise<void>
  tool: (name: string, input: unknown) => Promise<void>
  toolHang: (name: string, input: unknown) => Promise<void>
  reason: (value: string, opts?: { text?: string; usage?: Usage }) => Promise<void>
  fail: (message?: unknown) => Promise<void>
  error: (status: number, body: unknown) => Promise<void>
  hang: () => Promise<void>
  hold: (value: string, wait: PromiseLike<unknown>) => Promise<void>
  hits: () => Promise<Array<{ url: URL; body: Record<string, unknown> }>>
  calls: () => Promise<number>
  wait: (count: number) => Promise<void>
  inputs: () => Promise<Record<string, unknown>[]>
  pending: () => Promise<number>
  misses: () => Promise<Array<{ url: URL; body: Record<string, unknown> }>>
}

type LLMWorker = LLMFixture & {
  reset: () => Promise<void>
}

type AssistantFixture = {
  reply: LLMFixture["text"]
  tool: LLMFixture["tool"]
  toolHang: LLMFixture["toolHang"]
  reason: LLMFixture["reason"]
  fail: LLMFixture["fail"]
  error: LLMFixture["error"]
  hang: LLMFixture["hang"]
  hold: LLMFixture["hold"]
  calls: LLMFixture["calls"]
  pending: LLMFixture["pending"]
}

export const settingsKey = "settings.v3"

const seedModel = (() => {
  const [providerID = "opencode", modelID = "big-pickle"] = (
    process.env.OPENCODE_E2E_MODEL ?? "opencode/big-pickle"
  ).split("/")
  return {
    providerID: providerID || "opencode",
    modelID: modelID || "big-pickle",
  }
})()

function clean(value: string | null) {
  return (value ?? "").replace(/\u200B/g, "").trim()
}

async function visit(page: Page, url: string) {
  let err: unknown
  for (const _ of [0, 1, 2]) {
    try {
      await page.goto(url)
      return
    } catch (cause) {
      err = cause
      if (!String(cause).includes("ERR_CONNECTION_REFUSED")) throw cause
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  throw err
}

async function promptSend(page: Page) {
  return page
    .evaluate(() => {
      const win = window as E2EWindow
      const sent = win.__opencode_e2e?.prompt?.sent
      return {
        started: sent?.started ?? 0,
        count: sent?.count ?? 0,
        sessionID: sent?.sessionID,
        directory: sent?.directory,
      }
    })
    .catch(() => ({ started: 0, count: 0, sessionID: undefined, directory: undefined }))
}

type ProjectHandle = {
  directory: string
  slug: string
  gotoSession: (sessionID?: string) => Promise<void>
  trackSession: (sessionID: string, directory?: string) => void
  trackDirectory: (directory: string) => void
  sdk: ReturnType<typeof createSdk>
}

type ProjectOptions = {
  extra?: string[]
  model?: { providerID: string; modelID: string }
  setup?: (directory: string) => Promise<void>
  beforeGoto?: (project: { directory: string; sdk: ReturnType<typeof createSdk> }) => Promise<void>
}

type ProjectFixture = ProjectHandle & {
  open: (options?: ProjectOptions) => Promise<void>
  prompt: (text: string) => Promise<string>
  user: (text: string) => Promise<string>
  shell: (cmd: string) => Promise<string>
}

type TestFixtures = {
  llm: LLMFixture
  assistant: AssistantFixture
  project: ProjectFixture
  sdk: ReturnType<typeof createSdk>
  gotoSession: (sessionID?: string) => Promise<void>
}

type WorkerFixtures = {
  _llm: LLMWorker
  backend: {
    url: string
    sdk: (directory?: string) => ReturnType<typeof createSdk>
  }
  directory: string
  slug: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  _llm: [
    async ({}, use) => {
      const rt = ManagedRuntime.make(TestLLMServer.layer)
      try {
        const svc = await rt.runPromise(TestLLMServer.asEffect())
        await use({
          url: svc.url,
          push: (...input) => rt.runPromise(svc.push(...input)),
          pushMatch: (match, ...input) => rt.runPromise(svc.pushMatch(match, ...input)),
          textMatch: (match, value, opts) => rt.runPromise(svc.textMatch(match, value, opts)),
          toolMatch: (match, name, input) => rt.runPromise(svc.toolMatch(match, name, input)),
          text: (value, opts) => rt.runPromise(svc.text(value, opts)),
          tool: (name, input) => rt.runPromise(svc.tool(name, input)),
          toolHang: (name, input) => rt.runPromise(svc.toolHang(name, input)),
          reason: (value, opts) => rt.runPromise(svc.reason(value, opts)),
          fail: (message) => rt.runPromise(svc.fail(message)),
          error: (status, body) => rt.runPromise(svc.error(status, body)),
          hang: () => rt.runPromise(svc.hang),
          hold: (value, wait) => rt.runPromise(svc.hold(value, wait)),
          reset: () => rt.runPromise(svc.reset),
          hits: () => rt.runPromise(svc.hits),
          calls: () => rt.runPromise(svc.calls),
          wait: (count) => rt.runPromise(svc.wait(count)),
          inputs: () => rt.runPromise(svc.inputs),
          pending: () => rt.runPromise(svc.pending),
          misses: () => rt.runPromise(svc.misses),
        })
      } finally {
        await rt.dispose()
      }
    },
    { scope: "worker" },
  ],
  backend: [
    async ({ _llm }, use, workerInfo) => {
      const handle = await startBackend(`w${workerInfo.workerIndex}`, { llmUrl: _llm.url })
      try {
        await use({
          url: handle.url,
          sdk: (directory?: string) => createSdk(directory, handle.url),
        })
      } finally {
        await handle.stop()
      }
    },
    { scope: "worker" },
  ],
  llm: async ({ _llm }, use) => {
    await _llm.reset()
    await use({
      url: _llm.url,
      push: _llm.push,
      pushMatch: _llm.pushMatch,
      textMatch: _llm.textMatch,
      toolMatch: _llm.toolMatch,
      text: _llm.text,
      tool: _llm.tool,
      toolHang: _llm.toolHang,
      reason: _llm.reason,
      fail: _llm.fail,
      error: _llm.error,
      hang: _llm.hang,
      hold: _llm.hold,
      hits: _llm.hits,
      calls: _llm.calls,
      wait: _llm.wait,
      inputs: _llm.inputs,
      pending: _llm.pending,
      misses: _llm.misses,
    })
    const pending = await _llm.pending()
    if (pending > 0) {
      throw new Error(`TestLLMServer still has ${pending} queued response(s) after the test finished`)
    }
  },
  assistant: async ({ llm }, use) => {
    await use({
      reply: llm.text,
      tool: llm.tool,
      toolHang: llm.toolHang,
      reason: llm.reason,
      fail: llm.fail,
      error: llm.error,
      hang: llm.hang,
      hold: llm.hold,
      calls: llm.calls,
      pending: llm.pending,
    })
  },
  page: async ({ page }, use) => {
    let boundary: string | undefined
    setHealthPhase(page, "test")
    const consoleHandler = (msg: { text(): string }) => {
      const text = msg.text()
      if (!text.includes("[e2e:error-boundary]")) return
      if (healthPhase(page) === "cleanup") {
        console.warn(`[e2e:error-boundary][cleanup-warning]\n${text}`)
        return
      }
      boundary ||= text
      console.log(text)
    }
    const pageErrorHandler = (err: Error) => {
      console.log(`[e2e:pageerror] ${err.stack || err.message}`)
    }
    page.on("console", consoleHandler)
    page.on("pageerror", pageErrorHandler)
    await use(page)
    page.off("console", consoleHandler)
    page.off("pageerror", pageErrorHandler)
    if (boundary) throw new Error(boundary)
  },
  directory: [
    async ({ backend }, use) => {
      await use(await getWorktree(backend.url))
    },
    { scope: "worker" },
  ],
  slug: [
    async ({ directory }, use) => {
      await use(dirSlug(directory))
    },
    { scope: "worker" },
  ],
  sdk: async ({ directory, backend }, use) => {
    await use(backend.sdk(directory))
  },
  gotoSession: async ({ page, directory, backend }, use) => {
    await seedStorage(page, { directory, serverUrl: backend.url })

    const gotoSession = async (sessionID?: string) => {
      await visit(page, sessionPath(directory, sessionID))
      await waitSession(page, {
        directory,
        sessionID,
        serverUrl: backend.url,
        allowAnySession: !sessionID,
      })
    }
    await use(gotoSession)
  },
  project: async ({ page, llm, backend }, use) => {
    const item = makeProject(page, llm, backend)
    try {
      await use(item.project)
    } finally {
      await item.cleanup()
    }
  },
})

function makeProject(
  page: Page,
  llm: LLMFixture,
  backend: { url: string; sdk: (directory?: string) => ReturnType<typeof createSdk> },
) {
  let state:
    | {
        directory: string
        slug: string
        sdk: ReturnType<typeof createSdk>
        sessions: Map<string, string>
        dirs: Set<string>
      }
    | undefined

  const need = () => {
    if (state) return state
    throw new Error("project.open() must be called first")
  }

  const trackSession = (sessionID: string, directory?: string) => {
    const cur = need()
    cur.sessions.set(sessionID, directory ?? cur.directory)
  }

  const trackDirectory = (directory: string) => {
    const cur = need()
    if (directory !== cur.directory) cur.dirs.add(directory)
  }

  const gotoSession = async (sessionID?: string) => {
    const cur = need()
    await visit(page, sessionPath(cur.directory, sessionID))
    await waitSession(page, {
      directory: cur.directory,
      sessionID,
      serverUrl: backend.url,
      allowAnySession: !sessionID,
    })
    const current = sessionIDFromUrl(page.url())
    if (current) trackSession(current)
  }

  const open = async (options?: ProjectOptions) => {
    if (state) return
    const directory = await createTestProject({ serverUrl: backend.url })
    const sdk = backend.sdk(directory)
    await options?.setup?.(directory)
    await seedStorage(page, {
      directory,
      extra: options?.extra,
      model: options?.model,
      serverUrl: backend.url,
    })
    state = {
      directory,
      slug: "",
      sdk,
      sessions: new Map(),
      dirs: new Set(),
    }
    await options?.beforeGoto?.({ directory, sdk })
    await gotoSession()
    need().slug = await waitSlug(page)
  }

  const send = async (text: string, input: { noReply: boolean; shell: boolean }) => {
    if (input.noReply) {
      const cur = need()
      const state = await page.evaluate(() => {
        const model = (window as E2EWindow).__opencode_e2e?.model?.current
        if (!model) return null
        return {
          dir: model.dir,
          sessionID: model.sessionID,
          agent: model.agent,
          model: model.model ? { providerID: model.model.providerID, modelID: model.model.modelID } : undefined,
          variant: model.variant ?? undefined,
        }
      })
      const dir = state?.dir ?? cur.directory
      const sdk = backend.sdk(dir)
      const sessionID = state?.sessionID
        ? state.sessionID
        : await sdk.session.create({ directory: dir, title: "E2E Session" }).then((res) => {
            if (!res.data?.id) throw new Error("Failed to create no-reply session")
            return res.data.id
          })
      await sdk.session.prompt({
        sessionID,
        agent: state?.agent,
        model: state?.model,
        variant: state?.variant,
        noReply: true,
        parts: [{ type: "text", text }],
      })
      await visit(page, sessionPath(dir, sessionID))
      const active = await waitSession(page, {
        directory: dir,
        sessionID,
        serverUrl: backend.url,
      })
      trackSession(sessionID, active.directory)
      await waitSessionSaved(active.directory, sessionID, 90_000, backend.url)
      return sessionID
    }

    const prev = await promptSend(page)
    if (!input.noReply && !input.shell && (await llm.pending()) === 0) {
      await llm.text("ok")
    }

    const prompt = page.locator(promptSelector).first()
    const submit = async () => {
      await expect(prompt).toBeVisible()
      await prompt.click()
      if (input.shell) {
        await page.keyboard.type("!")
        await expect(prompt).toHaveAttribute("aria-label", /enter shell command/i)
      }
      await page.keyboard.type(text)
      await expect.poll(async () => clean(await prompt.textContent())).toBe(text)
      await page.keyboard.press("Enter")
      const started = await expect
        .poll(async () => (await promptSend(page)).started, { timeout: 5_000 })
        .toBeGreaterThan(prev.started)
        .then(() => true)
        .catch(() => false)
      if (started) return
      const send = page.getByRole("button", { name: "Send" }).first()
      const enabled = await send
        .isEnabled()
        .then((x) => x)
        .catch(() => false)
      if (enabled) {
        await send.click()
      } else {
        await prompt.click()
        await page.keyboard.press("Enter")
      }
      await expect.poll(async () => (await promptSend(page)).started, { timeout: 5_000 }).toBeGreaterThan(prev.started)
    }

    await submit()

    let next: { sessionID: string; directory: string } | undefined
    await expect
      .poll(
        async () => {
          const sent = await promptSend(page)
          if (sent.count <= prev.count) return ""
          if (!sent.sessionID || !sent.directory) return ""
          next = { sessionID: sent.sessionID, directory: sent.directory }
          return sent.sessionID
        },
        { timeout: 90_000 },
      )
      .not.toBe("")

    if (!next) throw new Error("Failed to observe prompt submission in e2e prompt probe")
    const active = await waitSession(page, {
      directory: next.directory,
      sessionID: next.sessionID,
      serverUrl: backend.url,
    })
    trackSession(next.sessionID, active.directory)
    if (!input.shell) {
      await waitSessionSaved(active.directory, next.sessionID, 90_000, backend.url)
    }
    await waitSessionIdle(backend.sdk(active.directory), next.sessionID, 90_000).catch(() => undefined)
    return next.sessionID
  }

  const prompt = async (text: string) => {
    return send(text, { noReply: false, shell: false })
  }

  const user = async (text: string) => {
    return send(text, { noReply: true, shell: false })
  }

  const shell = async (cmd: string) => {
    return send(cmd, { noReply: false, shell: true })
  }

  const cleanup = async () => {
    const cur = state
    if (!cur) return
    setHealthPhase(page, "cleanup")
    await Promise.allSettled(
      Array.from(cur.sessions, ([sessionID, directory]) =>
        cleanupSession({ sessionID, directory, serverUrl: backend.url }),
      ),
    )
    await Promise.allSettled(Array.from(cur.dirs, (directory) => cleanupTestProject(directory)))
    await cleanupTestProject(cur.directory)
    state = undefined
    setHealthPhase(page, "test")
  }

  return {
    project: {
      open,
      prompt,
      user,
      shell,
      gotoSession,
      trackSession,
      trackDirectory,
      get directory() {
        return need().directory
      },
      get slug() {
        return need().slug
      },
      get sdk() {
        return need().sdk
      },
    },
    cleanup,
  }
}

async function seedStorage(
  page: Page,
  input: {
    directory: string
    extra?: string[]
    model?: { providerID: string; modelID: string }
    serverUrl?: string
  },
) {
  const origin = input.serverUrl ?? serverUrl
  await page.addInitScript(
    (args: {
      directory: string
      serverUrl: string
      extra: string[]
      model: { providerID: string; modelID: string }
    }) => {
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      const parsed = (() => {
        if (!raw) return undefined
        try {
          return JSON.parse(raw) as unknown
        } catch {
          return undefined
        }
      })()

      const store = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject = store.lastProject && typeof store.lastProject === "object" ? store.lastProject : {}
      const projects = store.projects && typeof store.projects === "object" ? store.projects : {}
      const next = { ...(projects as Record<string, unknown>) }
      const nextList = list.includes(args.serverUrl) ? list : [args.serverUrl, ...list]

      const add = (origin: string, directory: string) => {
        const current = next[origin]
        const items = Array.isArray(current) ? current : []
        const existing = items.filter(
          (p): p is { worktree: string; expanded?: boolean } =>
            !!p &&
            typeof p === "object" &&
            "worktree" in p &&
            typeof (p as { worktree?: unknown }).worktree === "string",
        )
        if (existing.some((p) => p.worktree === directory)) return
        next[origin] = [{ worktree: directory, expanded: true }, ...existing]
      }

      for (const directory of [args.directory, ...args.extra]) {
        add("local", directory)
        add(args.serverUrl, directory)
      }

      localStorage.setItem(key, JSON.stringify({ list: nextList, projects: next, lastProject }))
      localStorage.setItem("opencode.settings.dat:defaultServerUrl", args.serverUrl)

      const win = window as E2EWindow
      win.__opencode_e2e = {
        ...win.__opencode_e2e,
        model: { enabled: true },
        prompt: { enabled: true },
        terminal: { enabled: true, terminals: {} },
      }
      localStorage.setItem("opencode.global.dat:model", JSON.stringify({ recent: [args.model], user: [], variant: {} }))
    },
    { directory: input.directory, serverUrl: origin, extra: input.extra ?? [], model: input.model ?? seedModel },
  )
}

export { expect }
