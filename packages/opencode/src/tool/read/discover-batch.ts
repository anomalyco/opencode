import z from "zod"
import { Effect } from "effect"
import { Tool } from "../shared/tool"
import { batchList, batchResult, stableBatchKey, type BatchOut } from "../shared/batch"
import {
  InspectArchiveParametersSchema,
  InspectDirParametersSchema,
  InspectFileParametersSchema,
  InspectMarkdownParametersSchema,
  InspectStructuredParametersSchema,
  InspectTool,
  InspectTreeParametersSchema,
} from "./inspect"
import { ContentSearchParametersSchema, PathSearchParametersSchema, SearchTool } from "./search"
import {
  LspDocumentSymbolParametersSchema,
  LspPositionalParametersSchema,
  LspTool,
  LspWorkspaceSymbolParametersSchema,
} from "./lsp"
import {
  LocalGitAnnotateParametersSchema,
  LocalGitAnnotateTool,
  LocalGitLogParametersSchema,
  LocalGitLogTool,
  LocalGitStateParametersSchema,
  LocalGitStateTool,
} from "../team-tools/localgit"

function withTool<T extends z.ZodObject<any>, ID extends string>(tool: ID, schema: T) {
  return schema.safeExtend({ tool: z.literal(tool) })
}

function withInspectTreeAliases(schema: z.ZodObject<any>) {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const item = value as Record<string, unknown>
    if (!("include_globs" in item) && !("ignore_globs" in item)) return value
    if ("include" in item || "ignore" in item) return value
    const { include_globs, ignore_globs, ...rest } = item
    return {
      ...rest,
      include: include_globs,
      ignore: ignore_globs,
    }
  }, schema)
}

const InspectFileCallSchema = withTool("inspect", InspectFileParametersSchema)
const InspectDirCallSchema = withTool("inspect", InspectDirParametersSchema)
const InspectTreeCallSchema = withInspectTreeAliases(withTool("inspect", InspectTreeParametersSchema))
const InspectStructuredCallSchema = withTool("inspect", InspectStructuredParametersSchema)
const InspectMarkdownCallSchema = withTool("inspect", InspectMarkdownParametersSchema)
const InspectArchiveCallSchema = withTool("inspect", InspectArchiveParametersSchema)

const SearchPathCallSchema = withTool("search", PathSearchParametersSchema)
const SearchContentCallSchema = withTool("search", ContentSearchParametersSchema)

const LocalGitStateCallSchema = withTool("localgit_state", LocalGitStateParametersSchema)
const LocalGitLogCallSchema = withTool("localgit_log", LocalGitLogParametersSchema)
const LocalGitAnnotateCallSchema = withTool("localgit_annotate", LocalGitAnnotateParametersSchema)

const LspWorkspaceSymbolCallSchema = withTool("lsp", LspWorkspaceSymbolParametersSchema)
const LspDocumentSymbolCallSchema = withTool("lsp", LspDocumentSymbolParametersSchema)
const LspPositionalCallSchema = withTool("lsp", LspPositionalParametersSchema)

export const DiscoverBatchCallSchema = z.union([
  InspectFileCallSchema,
  InspectDirCallSchema,
  InspectTreeCallSchema,
  InspectStructuredCallSchema,
  InspectMarkdownCallSchema,
  InspectArchiveCallSchema,
  SearchPathCallSchema,
  SearchContentCallSchema,
  LocalGitStateCallSchema,
  LocalGitLogCallSchema,
  LocalGitAnnotateCallSchema,
  LspWorkspaceSymbolCallSchema,
  LspDocumentSymbolCallSchema,
  LspPositionalCallSchema,
])

type InspectCall =
  | (z.infer<typeof InspectFileParametersSchema> & { tool: "inspect" })
  | (z.infer<typeof InspectDirParametersSchema> & { tool: "inspect" })
  | (z.infer<typeof InspectTreeParametersSchema> & { tool: "inspect" })
  | (z.infer<typeof InspectStructuredParametersSchema> & { tool: "inspect" })
  | (z.infer<typeof InspectMarkdownParametersSchema> & { tool: "inspect" })
  | (z.infer<typeof InspectArchiveParametersSchema> & { tool: "inspect" })
type SearchCall =
  | (z.infer<typeof PathSearchParametersSchema> & { tool: "search" })
  | (z.infer<typeof ContentSearchParametersSchema> & { tool: "search" })
type GitCall =
  | (z.infer<typeof LocalGitStateParametersSchema> & { tool: "localgit_state" })
  | (z.infer<typeof LocalGitLogParametersSchema> & { tool: "localgit_log" })
  | (z.infer<typeof LocalGitAnnotateParametersSchema> & { tool: "localgit_annotate" })
type LspCall =
  | (z.infer<typeof LspWorkspaceSymbolParametersSchema> & { tool: "lsp" })
  | (z.infer<typeof LspDocumentSymbolParametersSchema> & { tool: "lsp" })
  | (z.infer<typeof LspPositionalParametersSchema> & { tool: "lsp" })
type Call = InspectCall | SearchCall | GitCall | LspCall
type Row = {
  tool: Call["tool"]
  action?: string
  operation?: string
  out: BatchOut
}

function stripTool<T extends { tool: string }>(item: T): Omit<T, "tool"> {
  const { tool: _, ...rest } = item
  return rest
}

function coverageOf(item: Call) {
  return ["path" in item ? item.path : undefined, "filePath" in item ? item.filePath : undefined].filter(
    Boolean,
  ) as string[]
}

function actionOf(item: Call) {
  return "action" in item ? item.action : undefined
}

function operationOf(item: Call) {
  return "operation" in item ? item.operation : undefined
}

export const DiscoverBatchTool = Tool.defineEffect(
  "discover_batch",
  Effect.gen(function* () {
    const inspectInfo = yield* InspectTool

    return {
      description:
        "Run multiple canonical local discovery calls in one tool invocation. Use this for 2-4 independent, tightly scoped calls that can run in parallel. Each call must match exactly one nested tool shape from inspect, search, localgit_state, localgit_log, localgit_annotate, or lsp; mixed or speculative fields are rejected so the caller can retry cleanly. Prefer broad narrowing calls first (for example inspect:tree or search:path) before deeper file/content lookups.",
      parameters: z.object({
        calls: z
          .array(DiscoverBatchCallSchema)
          .min(1)
          .max(16)
          .describe("Ordered canonical discovery calls to run in one batch."),
      }),
      async execute(input: { calls: Call[] }, ctx: Tool.Context<Record<string, unknown>>) {
        const needs = new Set(input.calls.map((item) => item.tool))
        const [inspect, search, gitState, gitLog, gitAnnotate, lsp] = await Promise.all([
          needs.has("inspect") ? Effect.runPromise(Tool.init(inspectInfo)) : Promise.resolve(undefined),
          needs.has("search") ? SearchTool.init() : Promise.resolve(undefined),
          needs.has("localgit_state") ? LocalGitStateTool.init() : Promise.resolve(undefined),
          needs.has("localgit_log") ? LocalGitLogTool.init() : Promise.resolve(undefined),
          needs.has("localgit_annotate") ? LocalGitAnnotateTool.init() : Promise.resolve(undefined),
          needs.has("lsp") ? LspTool.init() : Promise.resolve(undefined),
        ])
        await ctx.ask({
          permission: "discover_batch",
          patterns: ["*"],
          always: ["*"],
          metadata: { count: input.calls.length },
        })

        const cache = new Map<string, Promise<Row>>()
        const rows = await Promise.all(
          input.calls.map(async (item) => {
            const key = stableBatchKey(item)
            const hit = cache.get(key)
            if (hit) return hit
            const next: Promise<Row> = (async () => {
              if (item.tool === "inspect") {
                const out =
                  item.action === "file"
                    ? await inspect!.execute(stripTool(item), ctx)
                    : item.action === "dir"
                      ? await inspect!.execute(stripTool(item), ctx)
                      : item.action === "tree"
                        ? await inspect!.execute(stripTool(item), ctx)
                        : item.action === "structured"
                          ? await inspect!.execute(stripTool(item), ctx)
                          : item.action === "markdown"
                            ? await inspect!.execute(stripTool(item), ctx)
                            : await inspect!.execute(stripTool(item), ctx)
                return {
                  tool: item.tool,
                  action: item.action,
                  out,
                }
              }
              if (item.tool === "search") {
                const out =
                  item.action === "path"
                    ? await search!.execute(stripTool(item), ctx)
                    : await search!.execute(stripTool(item), ctx)
                return {
                  tool: item.tool,
                  action: item.action,
                  out,
                }
              }
              if (item.tool === "localgit_state") {
                const out = await gitState!.execute(stripTool(item), ctx)
                return {
                  tool: item.tool,
                  action: item.action,
                  out,
                }
              }
              if (item.tool === "localgit_log") {
                const out = await gitLog!.execute(stripTool(item), ctx)
                return {
                  tool: item.tool,
                  action: item.action,
                  out,
                }
              }
              if (item.tool === "localgit_annotate") {
                const out = await gitAnnotate!.execute(stripTool(item), ctx)
                return {
                  tool: item.tool,
                  action: item.action,
                  out,
                }
              }
              const out =
                item.operation === "workspaceSymbol"
                  ? await lsp!.execute(stripTool(item), ctx)
                  : item.operation === "documentSymbol"
                    ? await lsp!.execute(stripTool(item), ctx)
                    : await lsp!.execute(stripTool(item), ctx)
              return {
                tool: item.tool,
                operation: item.operation,
                out,
              }
            })()
            cache.set(key, next)
            return next
          }),
        )

        const deduped = input.calls.length - cache.size
        const coverage = batchList(input.calls.flatMap(coverageOf))

        return batchResult({
          title: `discover batch (${rows.length})`,
          rows,
          mode: "parallel",
          deduped,
          coverage,
          call: (item) => ({
            tool: item.tool,
            action: item.action,
            operation: item.operation,
          }),
          result: (item) => ({
            tool: item.tool,
            action: item.action,
            operation: item.operation,
          }),
          include_result_output: false,
          label: (item) =>
            `${item.tool}${item.action ? `:${item.action}` : item.operation ? `:${item.operation}` : ""} — ${item.out.title}`,
        })
      },
    }
  }),
)
