import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiProjectCopyError, CreatePayload, RemovePayload } from "../groups/project-copy"
import { Agent } from "@/agent/agent"
import { LLM } from "@/session/llm"
import { LLMEvent } from "@opencode-ai/llm"
import { MessageID, SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"
import { Slug } from "@opencode-ai/core/util/slug"

const FALLBACK_AGENT: Agent.Info = {
  name: "title",
  mode: "primary" as const,
  permission: [],
  options: {},
  native: true,
  prompt: "",
}

function badRequest<A, R>(effect: Effect.Effect<A, ProjectCopy.Error, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new ApiProjectCopyError({
          name: "ProjectCopyError",
          data: { message: message(error) },
        }),
    ),
  )
}

export const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "projectCopy", (handlers) =>
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    const agent = yield* Agent.Service
    const provider = yield* Provider.Service
    const service = yield* ProjectCopy.Service

    const generateName = Effect.fn("ProjectCopyHttpApi.generateName")(function* (context: string | undefined) {
      const text = context?.trim()
      if (!text) return Slug.create()
      const [titleAgent, fallback] = yield* Effect.all(
        [
          agent.get("title").pipe(Effect.catch(() => Effect.succeed(FALLBACK_AGENT))),
          provider.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined))),
        ],
        { concurrency: 2 },
      )
      if (!fallback) return Slug.create()
      const model = titleAgent.model
        ? yield* provider.getModel(titleAgent.model.providerID, titleAgent.model.modelID)
        : ((yield* provider.getSmallModel(fallback.providerID)) ??
          (yield* provider.getModel(fallback.providerID, fallback.modelID)))
      const sessionID = SessionID.descending()
      const result = yield* llm
        .stream({
          agent: titleAgent,
          user: {
            id: MessageID.ascending(),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: titleAgent.name,
            model: { providerID: model.providerID, modelID: model.id },
          },
          system: [],
          small: true,
          tools: {},
          model,
          sessionID,
          retries: 2,
          messages: [
            {
              role: "user",
              content: `Generate a short filesystem-safe name for a project working copy based on this context:\n${text}`,
            },
          ],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
        )
      return slugify(result) || Slug.create()
    })

    const create = Effect.fn("ProjectCopyHttpApi.create")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: typeof CreatePayload.Type
    }) {
      const name =
        ctx.payload.name ??
        (yield* generateName(ctx.payload.context).pipe(Effect.catch(() => Effect.succeed(Slug.create()))))
      return yield* badRequest(
        service.create({
          ...ctx.payload,
          name,
          projectID: ctx.params.projectID,
          sourceDirectory: AbsolutePath.make((yield* InstanceState.context).worktree),
        }),
      )
    })

    const remove = Effect.fn("ProjectCopyHttpApi.remove")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: typeof RemovePayload.Type
    }) {
      yield* badRequest(
        service.remove({
          ...ctx.payload,
          projectID: ctx.params.projectID,
        }),
      )
    })

    const refresh = Effect.fn("ProjectCopyHttpApi.refresh")(function* (ctx: { params: { projectID: ProjectV2.ID } }) {
      yield* badRequest(
        service.refresh({
          projectID: ctx.params.projectID,
        }),
      )
    })

    return handlers.handle("create", create).handle("remove", remove).handle("refresh", refresh)
  }),
)

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function message(error: ProjectCopy.Error) {
  if (error instanceof ProjectCopy.SourceDirectoryNotFoundError)
    return `Project copy source not found: ${error.directory}`
  if (error instanceof ProjectCopy.DestinationExistsError)
    return `Project copy destination already exists: ${error.directory}`
  if (error instanceof ProjectCopy.DirectoryUnavailableError)
    return `Project copy directory unavailable: ${error.directory}`
  if (error instanceof ProjectCopy.StrategyNotFoundError)
    return `Project copy strategy not found for: ${error.directory}`
  return error.message
}
