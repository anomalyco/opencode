import type { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Skill } from "@opencode/schema/skill"
import { Tool } from "@opencode/schema/tool"
import type { Context as PluginContext, Plugin } from "@opencode/plugin/promise/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import type { SkillEditor } from "@opencode/plugin/promise/skill"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import { ExecutionRpc } from "../src/contract"
import executionPlugin from "../src/plugin"
import { containsReportingReminder, reportingReminderMarker } from "../src/reporting"
import type { StorageScanOptions, StorageScanResult, StorageValue } from "../src/repository"
import type {
  Changed,
  Evidence,
  ExecutionError,
  ReportCommand,
  RunSnapshot,
  Task,
  TaskDefinition,
} from "../src/schema"

const plan = { path: "docs/plan.md", sha256: "0".repeat(64) }

export const fixturePlan = plan

const definition: TaskDefinition = {
  id: "task-a",
  title: "Task A",
  phase: "Phase 1",
  order: 0,
  dependsOn: [],
  requiredGates: ["tests"],
  finalReview: false,
}

export function fixtureTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    title: "Task A",
    phase: "Phase 1",
    order: 0,
    dependsOn: [],
    state: "pending",
    attempt: 1,
    requiredGates: ["tests"],
    finalReview: false,
    ...overrides,
  }
}

export function fixtureRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 1,
    runID: "run-1",
    rootSessionID: "root",
    title: "Execution run",
    ownerDirectory: "/root/git/demo",
    plan: { ...plan, revision: 1 },
    revision: 1,
    status: "active",
    createdAt: 1_000,
    updatedAt: 1_000,
    tasks: [fixtureTask()],
    assignments: [],
    evidence: [],
    events: [],
    ...overrides,
  }
}

export function fixtureStart(overrides: Partial<ReportCommand> = {}): ReportCommand {
  return {
    operationID: "op-start",
    runID: "run-1",
    expectedRevision: 0,
    operation: { type: "run.start", title: "Execution run", plan, tasks: [definition] },
    ...overrides,
  }
}

export function fixtureReport(overrides: Partial<ReportCommand> = {}): ReportCommand {
  return {
    operationID: "op-report",
    runID: "run-1",
    expectedRevision: 1,
    operation: { type: "task.state", taskID: "task-a", attempt: 1, state: "running" },
    ...overrides,
  }
}

export function fixtureDefinition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return { ...definition, ...overrides }
}

export function fixtureDefinitions(): TaskDefinition[] {
  return [
    fixtureDefinition({ id: "spec", title: "Spec", phase: "Phase 1", order: 0, dependsOn: [] }),
    fixtureDefinition({ id: "impl", title: "Implement", phase: "Phase 1", order: 1, dependsOn: ["spec"] }),
    fixtureDefinition({
      id: "review",
      title: "Final review",
      phase: "Phase 2",
      order: 2,
      dependsOn: ["impl"],
      requiredGates: ["spec_review", "code_review"],
      finalReview: true,
    }),
    fixtureDefinition({ id: "docs", title: "Docs", phase: "Phase 1", order: 3, dependsOn: [] }),
  ]
}

export function fixtureEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    taskID: "task-a",
    attempt: 1,
    gate: "tests",
    outcome: "passed",
    summary: "tests passed",
    sessionID: "child",
    messageID: "msg-1",
    reportedBySessionID: "root",
    createdAt: 2,
    ...overrides,
  }
}

export function fixtureComplete(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    plan: { ...plan, revision: 2 },
    revision: 3,
    status: "completed",
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "verified" }),
      fixtureTask({
        id: "review",
        title: "Final review",
        order: 2,
        dependsOn: ["impl"],
        state: "verified",
        finalReview: true,
        requiredGates: ["spec_review", "code_review"],
      }),
    ],
    evidence: [
      fixtureEvidence({ id: "ev-spec", taskID: "spec" }),
      fixtureEvidence({ id: "ev-impl", taskID: "impl" }),
      fixtureEvidence({ id: "ev-review-spec", taskID: "review", gate: "spec_review" }),
      fixtureEvidence({ id: "ev-review-code", taskID: "review", gate: "code_review" }),
    ],
    ...overrides,
  })
}

export function fixtureFailure(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    revision: 3,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "failed", reason: "suite red" }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export function fixtureReopened(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    revision: 4,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "pending", attempt: 2 }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "pending", attempt: 2 }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export function fixtureScopeChange(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    plan: { ...plan, revision: 2 },
    revision: 4,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: [], state: "pending", attempt: 2 }),
      fixtureTask({ id: "docs", title: "Docs", order: 3, dependsOn: [], state: "skipped", reason: "Dropped from scope" }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export interface MemoryStorage {
  get(key: string): Promise<StorageValue | undefined>
  set(key: string, value: StorageValue): Promise<void>
  remove(key: string): Promise<void>
  scan(options: StorageScanOptions): Promise<StorageScanResult>
  writes(): number
  seed(key: string, value: StorageValue): void
  failNextSet(options?: { afterWrite?: boolean }): void
  failNextGet(): void
  failNextScan(): void
  pauseNextSet(): { started: Promise<void>; release: () => void }
}

export function memoryStorage(): MemoryStorage {
  const values = new Map<string, StorageValue>()
  let writeCount = 0
  let failSet: { afterWrite: boolean } | undefined
  let failGet = false
  let failScan = false
  let pause: { started: Promise<void>; released: Promise<void>; start: () => void; release: () => void } | undefined

  return {
    async get(key) {
      if (failGet) {
        failGet = false
        throw new Error("storage get failed")
      }
      const value = values.get(key)
      return value === undefined ? undefined : structuredClone(value)
    },
    async set(key, value) {
      const fault = failSet
      failSet = undefined
      if (fault !== undefined) {
        if (fault.afterWrite) {
          values.set(key, structuredClone(value))
          writeCount += 1
        }
        throw new Error("storage set failed")
      }
      const gate = pause
      if (gate !== undefined) {
        pause = undefined
        gate.start()
        await gate.released
      }
      values.set(key, structuredClone(value))
      writeCount += 1
    },
    async remove(key) {
      values.delete(key)
    },
    async scan(options) {
      if (failScan) {
        failScan = false
        throw new Error("storage scan failed")
      }
      const prefixMatches = [...values.keys()].filter((key) => key.startsWith(options.prefix)).sort()
      const after = options.after
      const remaining = after === undefined ? prefixMatches : prefixMatches.filter((key) => key > after)
      const page = options.limit === undefined ? remaining : remaining.slice(0, options.limit)
      return {
        entries: page.map((key) => ({ key, value: structuredClone(values.get(key)!) })),
        ...(page.length < remaining.length ? { next: page[page.length - 1] } : {}),
      }
    },
    writes: () => writeCount,
    seed(key, value) {
      values.set(key, structuredClone(value))
    },
    failNextSet(options) {
      failSet = { afterWrite: options?.afterWrite ?? false }
    },
    failNextGet() {
      failGet = true
    },
    failNextScan() {
      failScan = true
    },
    pauseNextSet() {
      const started = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      pause = { started: started.promise, released: released.promise, start: started.resolve, release: released.resolve }
      return { started: started.promise, release: released.resolve }
    },
  }
}

export interface SessionFixture {
  readonly id: string
  readonly parentID?: string
  readonly directory?: string
}

export interface PluginHarnessOptions {
  readonly sessions: readonly SessionFixture[]
  readonly location?: string
  readonly storage?: MemoryStorage
  readonly plugin?: Plugin
}

export interface Identity {
  readonly sessionID: string
}

export type HarnessResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExecutionError }

export interface RpcFailure {
  readonly type: string
  readonly message: string
  readonly data?: ExecutionError
}

export type RpcCallResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: RpcFailure }

export interface PluginHarness {
  readonly location: string
  readonly storage: MemoryStorage
  readonly definition: typeof ExecutionRpc
  toolNames(): readonly string[]
  callTool<T = unknown>(name: string, input: unknown, identity: Identity): Promise<HarnessResult<T>>
  invokeCapturedTool<T = unknown>(name: string, input: unknown, identity: Identity): Promise<HarnessResult<T>>
  callRpc<T = unknown>(name: string, input: unknown): Promise<RpcCallResult<T>>
  changes(): readonly Changed[]
  notifyWriteCounts(): readonly number[]
  hostAccesses(): readonly string[]
  sessionLookups(): number
  registrations(): {
    readonly rpc: number
    readonly toolTransforms: number
    readonly skillTransforms: number
    readonly sessionHooks: number
  }
  disposeCounts(): {
    readonly rpc: number
    readonly tools: number
    readonly skills: number
    readonly hooks: number
  }
  skills(): readonly Skill.Info[]
  applyContextHooks(context: SessionContext): Promise<void>
  reapplySkillTransforms(): Promise<void>
  historyWrites(): number
  durableMessages(): readonly string[]
  failNextSessionGet(): void
  dispose(): Promise<void>
}

interface CapturedTool extends Info {
  readonly id: string
}

type MutableSkill = { -readonly [K in keyof Skill.Info]: Skill.Info[K] }

type SchemaValidationResult =
  | { readonly value: unknown }
  | { readonly issues: readonly { readonly message?: string }[] }

interface StandardSchemaLike {
  readonly "~standard": {
    readonly validate: (value: unknown) => SchemaValidationResult | Promise<SchemaValidationResult>
  }
}

export async function pluginHarness(options: PluginHarnessOptions): Promise<PluginHarness> {
  const location = options.location ?? "/root/git/demo"
  const storage = options.storage ?? memoryStorage()
  const pluginDefinition = options.plugin ?? executionPlugin
  const sessions = new Map(options.sessions.map((session) => [session.id, session]))
  const accesses: string[] = []
  const changes: Changed[] = []
  const notifyWriteCounts: number[] = []
  const captured: CapturedTool[] = []
  const registered = new Map<string, CapturedTool>()
  const counters = {
    rpc: 0,
    toolTransforms: 0,
    skillTransforms: 0,
    sessionHooks: 0,
    rpcDisposals: 0,
    toolDisposals: 0,
    skillDisposals: 0,
    hookDisposals: 0,
  }
  const contextHooks: Array<(input: SessionContext) => Promise<void> | void> = []
  const skillTransforms: Array<(editor: SkillEditor) => void> = []
  const skills = new Map<string, MutableSkill>()
  const durableMessages: string[] = []
  let definition: typeof ExecutionRpc | undefined
  let handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>> = {}
  let cleanup: (() => Promise<void> | void) | undefined
  let failSessionGet = false
  let rpcDisposed = false
  let lookups = 0

  const lookup = async (sessionID: string) => {
    lookups += 1
    if (failSessionGet) {
      failSessionGet = false
      throw new Error("native session lookup failed")
    }
    const session = sessions.get(sessionID)
    if (session === undefined) return undefined
    return {
      id: session.id,
      ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
      location: { directory: session.directory ?? location },
    }
  }

  const editor: ToolEditor = {
    list: () => [...registered.values()],
    get: (id) => registered.get(id),
    namespace: () => undefined,
    add: (tool) => {
      const id = tool.options?.namespace === undefined ? tool.name : `${tool.options.namespace}_${tool.name}`
      const entry = { ...tool, id } as CapturedTool
      registered.set(id, entry)
      captured.push(entry)
    },
    update: (id, update) => {
      const tool = registered.get(id)
      if (tool !== undefined) update(tool)
    },
    remove: (id) => {
      registered.delete(id)
    },
  }

  const skillEditor: SkillEditor = {
    list: () => [...skills.values()],
    get: (id) => skills.get(id),
    add: (skill) => {
      skills.set(skill.id, { ...skill })
    },
    update: (id, update) => {
      const skill = skills.get(id)
      if (skill !== undefined) update(skill)
    },
    remove: (id) => {
      skills.delete(id)
    },
  }

  const domains: Record<string, unknown> = {
    app: { name: "opencode", version: "2.0.11", channel: "test" },
    location: { directory: location, project: { id: "project", directory: location, canonical: location } },
    options: {},
    storage,
    session: {
      get: (input: { readonly sessionID: string }) => lookup(input.sessionID),
      synthetic: async (input: { readonly sessionID: string; readonly text: string }) => {
        durableMessages.push(input.text)
      },
      hook: async (name: string, callback: (input: SessionContext) => Promise<void> | void) => {
        counters.sessionHooks += 1
        if (name !== "context") return { dispose: async () => {} }
        contextHooks.push(callback)
        let done = false
        return {
          dispose: async () => {
            if (done) return
            done = true
            counters.hookDisposals += 1
            const index = contextHooks.indexOf(callback)
            if (index !== -1) contextHooks.splice(index, 1)
          },
        }
      },
    },
    rpc: {
      register: async (nextDefinition: typeof ExecutionRpc, nextHandlers: typeof handlers) => {
        counters.rpc += 1
        definition = nextDefinition
        handlers = nextHandlers
        let done = false
        return {
          events: {
            emit: async (name: string, data: Changed) => {
              if (name !== "changed") return
              changes.push(data)
              notifyWriteCounts.push(storage.writes())
            },
          },
          dispose: async () => {
            if (done) return
            done = true
            counters.rpcDisposals += 1
            rpcDisposed = true
          },
        }
      },
    },
    tool: {
      transform: async (callback: (editor: ToolEditor) => void) => {
        counters.toolTransforms += 1
        callback(editor)
        let done = false
        return {
          dispose: async () => {
            if (done) return
            done = true
            counters.toolDisposals += 1
            registered.clear()
          },
        }
      },
    },
    skill: {
      list: async () => [...skills.values()],
      reload: async () => {},
      transform: async (callback: (editor: SkillEditor) => void) => {
        counters.skillTransforms += 1
        skillTransforms.push(callback)
        callback(skillEditor)
        let done = false
        return {
          dispose: async () => {
            if (done) return
            done = true
            counters.skillDisposals += 1
            const index = skillTransforms.indexOf(callback)
            if (index !== -1) skillTransforms.splice(index, 1)
            skills.clear()
          },
        }
      },
    },
  }

  const host = new Proxy(domains, {
    get(target, property) {
      if (typeof property !== "string") return undefined
      accesses.push(property)
      if (!Object.hasOwn(target, property)) throw new Error(`unavailable host domain: ${property}`)
      return target[property]
    },
  }) as unknown as PluginContext

  const returned = await pluginDefinition.setup(host)
  if (typeof returned === "function") cleanup = returned

  const contextFor = (identity: Identity): ToolContext => ({
    sessionID: identity.sessionID as Session.ID,
    agent: "agent" as Agent.ID,
    messageID: "message" as SessionMessage.ID,
    id: "call" as Tool.CallID,
    signal: new AbortController().signal,
    progress: async () => undefined,
  })

  const invoke = async <T>(tool: CapturedTool, input: unknown, identity: Identity): Promise<HarnessResult<T>> => {
    const decoded = await decodeInput(tool.input, input)
    if (!decoded.ok) return decoded
    try {
      const result = await tool.execute(decoded.value, contextFor(identity))
      return { ok: true, value: result.output as T }
    } catch (error) {
      if (error instanceof Tool.Error) return { ok: false, error: toolErrorData(error) }
      throw error
    }
  }

  return {
    location,
    storage,
    definition: definition as typeof ExecutionRpc,
    toolNames: () => [...registered.keys()],
    async callTool<T>(name: string, input: unknown, identity: Identity): Promise<HarnessResult<T>> {
      const tool = registered.get(name)
      if (tool === undefined) return { ok: false, error: { code: "not_found", detail: `tool not registered: ${name}` } }
      return invoke<T>(tool, input, identity)
    },
    async invokeCapturedTool<T>(name: string, input: unknown, identity: Identity): Promise<HarnessResult<T>> {
      const tool = captured.find((candidate) => candidate.name === name)
      if (tool === undefined) return { ok: false, error: { code: "not_found", detail: `tool was never registered: ${name}` } }
      return invoke<T>(tool, input, identity)
    },
    async callRpc<T>(name: string, input: unknown): Promise<RpcCallResult<T>> {
      if (rpcDisposed) return { ok: false, failure: { type: "rpc.method_not_found", message: `rpc unavailable: ${name}` } }
      const handler = handlers[name]
      if (handler === undefined) {
        return { ok: false, failure: { type: "rpc.method_not_found", message: `unknown rpc method: ${name}` } }
      }
      const failures: RpcFailure[] = []
      const context = {
        signal: new AbortController().signal,
        error: (type: string, message: string, data?: ExecutionError) => {
          const failure = data === undefined ? { type, message } : { type, message, data }
          failures.push(failure)
          return failure
        },
      }
      const value = await handler(input, context)
      if (failures.length > 0) return { ok: false, failure: failures[0] }
      return { ok: true, value: value as T }
    },
    changes: () => [...changes],
    notifyWriteCounts: () => [...notifyWriteCounts],
    hostAccesses: () => [...accesses],
    sessionLookups: () => lookups,
    registrations: () => ({
      rpc: counters.rpc,
      toolTransforms: counters.toolTransforms,
      skillTransforms: counters.skillTransforms,
      sessionHooks: counters.sessionHooks,
    }),
    disposeCounts: () => ({
      rpc: counters.rpcDisposals,
      tools: counters.toolDisposals,
      skills: counters.skillDisposals,
      hooks: counters.hookDisposals,
    }),
    skills: () => [...skills.values()],
    async applyContextHooks(context) {
      for (const hook of [...contextHooks]) await hook(context)
    },
    async reapplySkillTransforms() {
      for (const callback of [...skillTransforms]) callback(skillEditor)
    },
    historyWrites: () => durableMessages.length,
    durableMessages: () => [...durableMessages],
    failNextSessionGet() {
      failSessionGet = true
    },
    async dispose() {
      await cleanup?.()
    },
  }
}

export interface ReportingContextInput {
  readonly system?: SessionContext["system"]
  readonly messages?: SessionContext["messages"]
}

export interface ReportingHarness extends PluginHarness {
  context(sessionID: string, overrides?: ReportingContextInput): SessionContext
  apply(context: SessionContext): Promise<void>
  hasReportingReminder(context: SessionContext): boolean
  reportingReminderCount(context: SessionContext): number
  reminders(context: SessionContext): readonly string[]
}

export async function reportingHarness(options: PluginHarnessOptions = defaultReportingOptions()): Promise<ReportingHarness> {
  const plugin = await pluginHarness(options)
  return {
    ...plugin,
    context: (sessionID, overrides = {}) => reportingContext(sessionID, overrides),
    apply: (context) => plugin.applyContextHooks(context),
    hasReportingReminder: (context) => containsReportingReminder(context.system),
    reportingReminderCount: (context) =>
      context.system.filter((part) => part.text.includes(reportingReminderMarker)).length,
    reminders: (context) =>
      context.system.flatMap((part) => (part.text.includes(reportingReminderMarker) ? [part.text] : [])),
  }
}

function defaultReportingOptions(): PluginHarnessOptions {
  return {
    sessions: [
      { id: "root" },
      { id: "child", parentID: "root" },
    ],
  }
}

function reportingContext(sessionID: string, overrides: ReportingContextInput): SessionContext {
  return {
    sessionID: sessionID as Session.ID,
    agent: "agent" as Agent.ID,
    model: { id: "model", providerID: "provider" },
    system: overrides.system ?? [],
    messages: overrides.messages ?? [],
    options: {},
    tools: {},
  } as SessionContext
}

async function decodeInput(schema: unknown, input: unknown): Promise<HarnessResult<unknown>> {
  if (!isStandardSchema(schema)) return { ok: true, value: input }
  const result = await schema["~standard"].validate(input)
  if ("issues" in result) {
    const detail = result.issues.map((issue) => issue.message ?? "invalid input").join("; ")
    return { ok: false, error: { code: "invalid_input", detail } }
  }
  return { ok: true, value: result.value }
}

function isStandardSchema(value: unknown): value is StandardSchemaLike {
  return typeof value === "object" && value !== null && "~standard" in value
}

function toolErrorData(error: Tool.Error): ExecutionError {
  const candidate = error.metadata?.execution ?? error.error
  if (isExecutionError(candidate)) return candidate
  return { code: "storage_unavailable", detail: error.message }
}

function isExecutionError(value: unknown): value is ExecutionError {
  if (typeof value !== "object" || value === null) return false
  return "code" in value && typeof value.code === "string"
}
