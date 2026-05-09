import type { Duration, Effect } from "effect"
import type { Config } from "../../../src/config/config"
import type { Project } from "../../../src/project/project"
import type { Worktree } from "../../../src/worktree"
import type { MessageV2 } from "../../../src/session/message-v2"
import type { SessionID } from "../../../src/session/schema"

export const OpenApiMethods = ["get", "post", "put", "delete", "patch"] as const
export const Methods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const

export type Method = (typeof Methods)[number]
export type OpenApiMethod = (typeof OpenApiMethods)[number]
export type Mode = "effect" | "parity" | "coverage" | "auth"
export type Backend = "effect" | "legacy"
export type Comparison = "none" | "status" | "json"
export type CaptureMode = "full" | "stream"
export type AuthPolicy = "protected" | "public" | "public-bypass" | "ticket-bypass"
export type ProjectOptions = { git?: boolean; config?: Partial<Config.Info>; llm?: boolean }
export type OpenApiSpec = { paths?: Record<string, Partial<Record<OpenApiMethod, unknown>>> }
export type JsonObject = Record<string, unknown>

export type Options = {
  mode: Mode
  include: string | undefined
  startAt: string | undefined
  stopAt: string | undefined
  failOnMissing: boolean
  failOnSkip: boolean
  scenarioTimeout: Duration.Duration
  progress: boolean
  trace: boolean
}

export type RequestSpec = {
  path: string
  headers?: Record<string, string>
  body?: unknown
}

export type CallResult = {
  status: number
  contentType: string
  body: unknown
  text: string
  timedOut: boolean
}

export type BackendApp = {
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

/** Effect-native helpers available while setting up and asserting a scenario. */
export type ScenarioContext = {
  directory: string | undefined
  headers: (extra?: Record<string, string>) => Record<string, string>
  file: (name: string, content: string) => Effect.Effect<void>
  session: (input?: { title?: string; parentID?: SessionID }) => Effect.Effect<SessionInfo>
  sessionGet: (sessionID: SessionID) => Effect.Effect<SessionInfo | undefined>
  project: () => Effect.Effect<Project.Info>
  message: (sessionID: SessionID, input?: { text?: string }) => Effect.Effect<MessageSeed>
  messages: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts[]>
  todos: (sessionID: SessionID, todos: TodoInfo[]) => Effect.Effect<void>
  worktree: (input?: { name?: string }) => Effect.Effect<Worktree.Info>
  worktreeRemove: (directory: string) => Effect.Effect<void>
  llmText: (value: string) => Effect.Effect<void>
  llmWait: (count: number) => Effect.Effect<void>
  tuiRequest: (request: { path: string; body: unknown }) => Effect.Effect<void>
}

/** Scenario context after `.seeded(...)`; `state` preserves the seed return type in the DSL. */
export type SeededContext<S> = ScenarioContext & {
  state: S
}

export type Scenario = ActiveScenario | TodoScenario
export type ActiveScenario = {
  kind: "active"
  method: Method
  path: string
  name: string
  project: ProjectOptions | undefined
  seed: (ctx: ScenarioContext) => Effect.Effect<unknown>
  request: (ctx: ScenarioContext, state: unknown) => RequestSpec
  authProbe: RequestSpec | undefined
  expect: (ctx: ScenarioContext, state: unknown, result: CallResult) => Effect.Effect<void>
  compare: Comparison
  capture: CaptureMode
  mutates: boolean
  reset: boolean
  auth: AuthPolicy
}

export type BuilderState<S> = {
  method: Method
  path: string
  name: string
  project: ProjectOptions | undefined
  seed: (ctx: ScenarioContext) => Effect.Effect<S>
  request: (ctx: SeededContext<S>) => RequestSpec
  authProbe: RequestSpec | undefined
  capture: CaptureMode
  mutates: boolean
  reset: boolean
  auth: AuthPolicy
}

export type TodoScenario = {
  kind: "todo"
  method: Method
  path: string
  name: string
  reason: string
}

export type Result =
  | { status: "pass"; scenario: ActiveScenario }
  | { status: "fail"; scenario: ActiveScenario; message: string }
  | { status: "skip"; scenario: TodoScenario }

export type SessionInfo = { id: SessionID; title: string; parentID?: SessionID }
export type TodoInfo = { content: string; status: string; priority: string }
export type MessageSeed = { info: MessageV2.User; part: MessageV2.TextPart }
