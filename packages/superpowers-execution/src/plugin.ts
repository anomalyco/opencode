import { Plugin } from "@opencode/plugin"
import type { RpcHandlers } from "@opencode/plugin/promise/rpc"
import type { Info } from "@opencode/plugin/promise/tool"
import { Tool } from "@opencode/schema/tool"
import { z } from "zod"
import { ExecutionRpc } from "./contract"
import { createSessionReader, resolveReportPrincipal, type ResolvedPrincipal, type SessionReader } from "./principal"
import { createRunRepository, type RunRepository } from "./repository"
import {
  IdentifierSchema,
  ReportCommandSchema,
  RevisionSchema,
  RunSnapshotSchema,
  type Changed,
  type ExecutionError,
  type ReportCommand,
  type RunSnapshot,
} from "./schema"

export const pluginVersion = "0.1.0"

const reportOutputSchema = z.strictObject({
  run: RunSnapshotSchema,
  appliedRevision: RevisionSchema,
  duplicate: z.boolean(),
})

const readInputSchema = z.strictObject({ runID: IdentifierSchema.optional() })

const readOutputSchema = z.strictObject({ run: RunSnapshotSchema.nullable() })

export function createRepositoryForContext(
  ctx: Pick<Plugin.Context, "storage" | "location">,
  onChanged: (event: Changed) => void | Promise<void>,
): RunRepository {
  return createRunRepository({
    storage: ctx.storage,
    ownerDirectory: ctx.location.directory,
    now: Date.now,
    onChanged,
  })
}

export function createReportTool(
  ctx: Plugin.Context,
  repository: RunRepository,
): Info<typeof ReportCommandSchema, typeof reportOutputSchema> {
  const readSession = createSessionReader(ctx.session)
  return {
    name: "execution_report",
    description:
      "Record one durable Superpowers execution change for the calling root controller session. Only the real root session may report. Read the current revision with execution_read before retrying a conflict, and reuse the same operationID for one attempted write.",
    input: ReportCommandSchema,
    output: reportOutputSchema,
    async execute(input, tool) {
      const principal = await requireRootReporter(ctx, readSession, tool.sessionID)
      const referenced = sessionReference(input.operation)
      if (referenced !== undefined) await requireRunSession(principal.rootSessionID, referenced, readSession)
      const outcome = await repository.report(input, {
        sessionID: principal.sessionID,
        rootSessionID: principal.rootSessionID,
      })
      if (!outcome.ok) throw toolFailure(outcome.error)
      return { output: outcome.value }
    },
  }
}

export function createReadTool(
  ctx: Plugin.Context,
  repository: RunRepository,
): Info<typeof readInputSchema, typeof readOutputSchema> {
  const readSession = createSessionReader(ctx.session)
  return {
    name: "execution_read",
    description:
      "Read the Superpowers execution run owned by the calling session's root. Omit runID for the active run; returns {run:RunSnapshot|null}.",
    input: readInputSchema,
    output: readOutputSchema,
    async execute(input, tool) {
      const principal = await requireOwnedPrincipal(ctx, readSession, tool.sessionID)
      const run = await readRun(repository, principal.rootSessionID, input.runID)
      return { output: { run } }
    },
  }
}

export function createReadHandlers(repository: RunRepository, version: string): RpcHandlers<typeof ExecutionRpc> {
  return {
    capabilities: async () => ({
      schemaVersion: 1,
      pluginVersion: version,
      maxTasks: 500,
      reporting: "controller",
    }),
    listRuns: async (input, context) => {
      const outcome = await repository.listRuns(input)
      if (!outcome.ok) return context.error("execution", outcome.error.detail, outcome.error)
      return outcome.value
    },
    getRun: async (input, context) => {
      const outcome = await repository.getRun(input.rootSessionID, input.runID)
      if (!outcome.ok) return context.error("execution", outcome.error.detail, outcome.error)
      return outcome.value
    },
    getSummaries: async (input, context) => {
      const outcome = await repository.getSummaries(input)
      if (!outcome.ok) return context.error("execution", outcome.error.detail, outcome.error)
      return outcome.value
    },
  }
}

async function requireRootReporter(
  ctx: Pick<Plugin.Context, "location">,
  readSession: SessionReader,
  callerSessionID: string,
): Promise<ResolvedPrincipal> {
  const principal = await requireOwnedPrincipal(ctx, readSession, callerSessionID)
  if (principal.sessionID !== principal.rootSessionID) {
    throw toolFailure({ code: "forbidden", detail: "only the root controller session can report" })
  }
  return principal
}

async function requireOwnedPrincipal(
  ctx: Pick<Plugin.Context, "location">,
  readSession: SessionReader,
  callerSessionID: string,
): Promise<ResolvedPrincipal> {
  const resolved = await resolveReportPrincipal(callerSessionID, readSession)
  if (!resolved.ok) throw toolFailure(resolved.error)
  if (resolved.value.directory !== ctx.location.directory) {
    throw toolFailure({ code: "forbidden", detail: "this location does not own the resolved run" })
  }
  return resolved.value
}

async function requireRunSession(
  rootSessionID: string,
  sessionID: string,
  readSession: SessionReader,
): Promise<void> {
  const resolved = await resolveReportPrincipal(sessionID, readSession)
  if (!resolved.ok) throw toolFailure(resolved.error)
  if (resolved.value.rootSessionID !== rootSessionID) {
    throw toolFailure({ code: "forbidden", detail: `session ${sessionID} does not belong to run ${rootSessionID}` })
  }
}

function sessionReference(operation: ReportCommand["operation"]): string | undefined {
  if (operation.type === "assignment.add" || operation.type === "evidence.add") return operation.sessionID
  return undefined
}

async function readRun(
  repository: RunRepository,
  rootSessionID: string,
  runID: string | undefined,
): Promise<RunSnapshot | null> {
  if (runID !== undefined) {
    const outcome = await repository.getRun(rootSessionID, runID)
    if (!outcome.ok) throw toolFailure(outcome.error)
    return outcome.value
  }
  const summaries = await repository.getSummaries({ rootSessionIDs: [rootSessionID] })
  if (!summaries.ok) throw toolFailure(summaries.error)
  const active = summaries.value.items.find((item) => item.status === "active")
  if (active === undefined) return null
  const outcome = await repository.getRun(rootSessionID, active.runID)
  if (!outcome.ok) throw toolFailure(outcome.error)
  return outcome.value
}

function toolFailure(error: ExecutionError): Tool.Error {
  return new Tool.Error({ message: error.detail, error, metadata: { execution: error } })
}

export default Plugin.define({
  id: "superpowers-execution",
  async setup(ctx) {
    let emitChanged: ((event: Changed) => Promise<void>) | undefined
    const repository = createRepositoryForContext(ctx, (event) => emitChanged?.(event))
    const rpc = await ctx.rpc.register(ExecutionRpc, createReadHandlers(repository, pluginVersion))
    emitChanged = (event) => rpc.events.emit("changed", event)
    const tools = await ctx.tool.transform((editor) => {
      editor.add(createReportTool(ctx, repository))
      editor.add(createReadTool(ctx, repository))
    })
    return async () => {
      await repository.close()
      await tools.dispose()
      await rpc.dispose()
    }
  },
})
