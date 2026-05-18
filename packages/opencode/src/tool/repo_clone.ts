import { Effect, Schema } from "effect"
import DESCRIPTION from "./repo_clone.txt"
import * as Tool from "./tool"
import { repositoryCachePath } from "@/util/repository"
import { RepositoryCache } from "@/reference/repository-cache"

export const Parameters = Schema.Struct({
  repository: Schema.String.annotate({
    description: "Repository to clone, as a git URL, host/path reference, or GitHub owner/repo shorthand",
  }),
  refresh: Schema.optional(Schema.Boolean).annotate({
    description: "When true, fetches the latest remote state into the managed cache",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "Branch or ref to clone and inspect",
  }),
})

type Metadata = {
  repository: string
  host: string
  remote: string
  localPath: string
  status: "cached" | "cloned" | "refreshed"
  head?: string
  branch?: string
}

export const RepoCloneTool = Tool.define<typeof Parameters, Metadata, RepositoryCache.Service>(
  "repo_clone",
  Effect.gen(function* () {
    const cache = yield* RepositoryCache.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const reference = yield* RepositoryCache.parseRemoteReference(params.repository)
          if (params.branch) yield* RepositoryCache.validateBranch(params.branch)

          const repository = reference.label
          const remote = reference.remote
          const localPath = repositoryCachePath(reference)

          yield* ctx.ask({
            permission: "repo_clone",
            patterns: [repository],
            always: [repository],
            metadata: {
              repository,
              remote,
              path: localPath,
              refresh: Boolean(params.refresh),
              branch: params.branch,
            },
          })

          const result = yield* cache.ensure({ reference, refresh: params.refresh, branch: params.branch })
          return {
            title: repository,
            metadata: result,
            output: [
              `Repository ready: ${repository}`,
              `Status: ${result.status}`,
              `Local path: ${localPath}`,
              ...(result.branch ? [`Branch: ${result.branch}`] : []),
              ...(result.head ? [`HEAD: ${result.head}`] : []),
            ].join("\n"),
          }
        }).pipe(
          Effect.catchIf(RepositoryCache.isError, (error) => Effect.fail(new Error(error.message))),
          Effect.orDie,
        ),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
