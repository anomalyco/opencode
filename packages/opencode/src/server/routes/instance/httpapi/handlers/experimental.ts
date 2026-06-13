import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { renderOutput } from "@/tool/task"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { ModelV2 } from "@cedric/core/model"
import { ProviderV2 } from "@cedric/core/provider"
import { Effect, Option, Scope } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConsoleSwitchPayload, SessionListQuery, ToolListQuery, WorktreeApiError } from "../groups/experimental"

function stoppedAfterRestart<T extends { status: string; completedAt?: number; updatedAt: number; error?: string }>(job: T) {
  if (job.status !== "running") return job
  return {
    ...job,
    status: "error" as const,
    completedAt: job.completedAt ?? job.updatedAt,
    updatedAt: job.completedAt ?? job.updatedAt,
    retryable: true,
    error: job.error ?? "Background task stopped before completion because Cedric restarted.",
  }
}

const RECOVERY_PROMPT = [
  "Cedric restarted while this background task was running.",
  "Continue the same background task from the existing conversation context.",
  "Do not restart completed work unless it is necessary to produce the final result.",
].join("\n")

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service
    const sessions = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const background = yield* BackgroundJob.Service
    const flags = yield* RuntimeFlags.Service
    const scope = yield* Scope.Scope

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: typeof Worktree.CreateInput.Type | void
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload ?? undefined))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const all = yield* sessions.listGlobal({
        directory: ctx.query.directory,
        roots: ctx.query.roots,
        start: ctx.query.start,
        cursor: ctx.query.cursor,
        search: ctx.query.search,
        limit: limit + 1,
        archived: ctx.query.archived,
      })
      const list = all.length > limit ? all.slice(0, limit) : all
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          all.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const sessionBackground = Effect.fn("ExperimentalHttpApi.sessionBackground")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      if (!flags.experimentalBackgroundSubagents) return false
      const jobs = (yield* background.list()).filter(
        (job) =>
          job.type === "task" &&
          job.status === "running" &&
          job.metadata?.parentSessionId === ctx.params.sessionID &&
          job.metadata.background !== true,
      )
      const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
      return promoted.some((job) => job !== undefined)
    })

    const sessionBackgroundJobs = Effect.fn("ExperimentalHttpApi.sessionBackgroundJobs")(function* () {
      const ctx = yield* InstanceState.context
      const live = (yield* background.list()).flatMap((job) => {
        const task = BackgroundJob.taskJob(job)
        return task ? [task] : []
      })
      const liveByID = new Map(live.map((job) => [job.id, job] as const))
      const durable = (yield* sessions.listGlobal({ directory: ctx.directory, limit: 500 })).flatMap((session) => {
        const job = BackgroundJob.taskJobFromMetadata(session.metadata)
        if (!job || liveByID.has(job.id)) return []
        return [stoppedAfterRestart(job)]
      })
      return [...live, ...durable].toSorted((a, b) => b.updatedAt - a.updatedAt)
    })

    const notifyRecoveredTask = Effect.fn("ExperimentalHttpApi.notifyRecoveredTask")(function* (input: {
      jobID: string
      sessionID: SessionID
      parentSessionID: SessionID
      title?: string
    }) {
      yield* background.wait({ id: input.jobID }).pipe(
        Effect.flatMap((result) => {
          if (result.info?.status === "completed") {
            return promptSvc.prompt({
              sessionID: input.parentSessionID,
              parts: [
                {
                  type: "text",
                  synthetic: true,
                  text: renderOutput({
                    sessionID: input.sessionID,
                    state: "completed",
                    summary: `Background task completed: ${input.title ?? "Recovered task"}`,
                    text: result.info.output ?? "",
                  }),
                },
              ],
            })
          }
          if (result.info?.status === "error") {
            return promptSvc.prompt({
              sessionID: input.parentSessionID,
              parts: [
                {
                  type: "text",
                  synthetic: true,
                  text: renderOutput({
                    sessionID: input.sessionID,
                    state: "error",
                    summary: `Background task failed: ${input.title ?? "Recovered task"}`,
                    text: result.info.error ?? "",
                  }),
                },
              ],
            })
          }
          return Effect.void
        }),
        Effect.ignore,
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    const sessionBackgroundJobRetry = Effect.fn("ExperimentalHttpApi.sessionBackgroundJobRetry")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const live = yield* background.get(ctx.params.sessionID)
      const liveTask = live ? BackgroundJob.taskJob(live) : undefined
      if (liveTask?.status === "running") return liveTask

      const child = yield* sessions.get(ctx.params.sessionID).pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      const stored = BackgroundJob.taskJobFromMetadata(child.metadata)
      if (!stored || stored.status !== "running") return yield* new HttpApiError.BadRequest({})
      const parentSessionID = SessionID.make(stored.parentSessionID)
      yield* sessions.get(parentSessionID).pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))

      const started = yield* background.start({
        id: ctx.params.sessionID,
        type: "task",
        title: stored.title,
        metadata: {
          parentSessionId: stored.parentSessionID,
          sessionId: stored.sessionID,
          background: true,
          recovered: true,
          ...(stored.model
            ? {
                model: {
                  providerID: ProviderV2.ID.make(stored.model.providerID),
                  modelID: ModelV2.ID.make(stored.model.modelID),
                },
              }
            : {}),
        },
        run: promptSvc
          .prompt({
            sessionID: ctx.params.sessionID,
            agent: child.agent,
            ...(stored.model
              ? {
                  model: {
                    providerID: ProviderV2.ID.make(stored.model.providerID),
                    modelID: ModelV2.ID.make(stored.model.modelID),
                  },
                }
              : {}),
            parts: [{ type: "text", text: RECOVERY_PROMPT }],
          })
          .pipe(Effect.map((result) => result.parts.findLast((part) => part.type === "text")?.text ?? "")),
      })
      yield* notifyRecoveredTask({
        jobID: started.id,
        sessionID: ctx.params.sessionID,
        parentSessionID,
        title: stored.title,
      })
      const task = BackgroundJob.taskJob(started)
      if (!task) return yield* new HttpApiError.BadRequest({})
      return task
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    return handlers
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("sessionBackground", sessionBackground)
      .handle("sessionBackgroundJobs", sessionBackgroundJobs)
      .handle("sessionBackgroundJobRetry", sessionBackgroundJobRetry)
      .handle("resource", resource)
  }),
)
