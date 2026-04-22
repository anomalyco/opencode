import path from "path"
import z from "zod"
import { Effect } from "effect"
import { Tool } from "../shared/tool"
import { Instance } from "../../project/instance"
import { FileTool } from "./internal/file"
import { assertExternalDirectory } from "../external-directory"
import { blank, empty, sanitizeDiscriminatedInput, zero } from "../shared/shape"
import { DirTreeTool } from "./internal/dir-tree"
import { DataQueryTool } from "./internal/data-query"
import { MarkdownReadTool } from "./internal/markdown-read"
import { ArchiveListTool } from "./internal/archive-list"

const structuredModes = ["summary", "get", "keys", "entries", "slice", "search"] as const
const markdownModes = ["outline", "section", "search", "frontmatter"] as const
const inspectAllowed = {
  file: ["filePath", "offset", "limit"],
  dir: ["path", "offset", "limit"],
  tree: ["path", "limit", "include", "ignore", "depth", "follow", "dirs_only", "counts"],
  structured: ["filePath", "offset", "limit", "mode", "pointer", "pattern", "match", "case_sensitive", "scope"],
  markdown: [
    "filePath",
    "limit",
    "mode",
    "pointer",
    "pattern",
    "match",
    "case_sensitive",
    "heading",
    "occurrence",
    "max_level",
  ],
  archive: ["filePath", "limit", "pattern", "match", "case_sensitive"],
} as const
const inspectInjectedDefaults = {
  depth: (value: unknown) => value === 1,
  mode: (value: unknown) => value === "summary",
  match: (value: unknown) => value === "literal",
  scope: (value: unknown) => value === "both",
  occurrence: (value: unknown) => value === 1,
  max_level: (value: unknown) => value === 6,
} satisfies Partial<Record<string, (value: unknown) => boolean>>

export const InspectFileParametersSchema = z
  .object({
    action: z.literal("file").describe("Inspection action to run."),
    filePath: z.preprocess(blank, z.string()).describe("File path to read as numbered lines."),
    offset: z
      .preprocess(zero, z.coerce.number().int().min(0).optional())
      .describe("Optional 1-based starting line offset."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of lines to return."),
  })
  .strict()

export const InspectDirParametersSchema = z
  .object({
    action: z.literal("dir").describe("Inspection action to run."),
    path: z
      .preprocess(blank, z.string().optional())
      .describe("Directory path to list. Defaults to the current working directory when omitted."),
    offset: z.preprocess(zero, z.coerce.number().int().min(0).optional()).describe("Optional 1-based entry offset."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of entries to return."),
  })
  .strict()

export const InspectTreeParametersSchema = z
  .object({
    action: z.literal("tree").describe("Inspection action to run."),
    path: z
      .preprocess(blank, z.string().optional())
      .describe("Directory path to render recursively. Defaults to the current working directory when omitted."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of scanned files before truncation."),
    include: z
      .preprocess(empty, z.array(z.string()).optional())
      .describe("Optional positive glob filters for files to include in the tree."),
    ignore: z.preprocess(empty, z.array(z.string()).optional()).describe("Additional glob patterns to ignore."),
    depth: z
      .preprocess(zero, z.coerce.number().int().min(1).max(12).optional())
      .describe("Maximum directory depth for tree reads."),
    follow: z.boolean().optional().describe("Follow symlinks in tree reads."),
    dirs_only: z.boolean().optional().describe("Show directories only and omit file names."),
    counts: z.boolean().optional().describe("Show per-directory counts next to each directory."),
  })
  .strict()

export const InspectStructuredParametersSchema = z
  .object({
    action: z.literal("structured").describe("Inspection action to run."),
    filePath: z.preprocess(blank, z.string()).describe("Path to a JSON, JSONC, or TOML file."),
    offset: z
      .preprocess(zero, z.coerce.number().int().min(0).optional())
      .describe("Optional offset for keys, entries, or slices."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of returned items or matches."),
    mode: z.enum(structuredModes).optional().describe("Optional structured sub-mode."),
    pointer: z
      .preprocess(blank, z.string().optional())
      .describe("Optional JSON Pointer path used to narrow the target location."),
    pattern: z.preprocess(blank, z.string().optional()).describe("Optional search pattern for search mode."),
    match: z.enum(["literal", "regex"]).optional().describe("How to interpret pattern values where supported."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive matching where supported."),
    scope: z.enum(["keys", "values", "both"]).optional().describe("Structured search scope."),
  })
  .strict()

export const InspectMarkdownParametersSchema = z
  .object({
    action: z.literal("markdown").describe("Inspection action to run."),
    filePath: z.preprocess(blank, z.string()).describe("Path to a Markdown file."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of headings or matches to return."),
    mode: z.enum(markdownModes).optional().describe("Optional Markdown sub-mode."),
    pointer: z.preprocess(blank, z.string().optional()).describe("Optional JSON Pointer for frontmatter reads."),
    pattern: z.preprocess(blank, z.string().optional()).describe("Optional heading search pattern."),
    match: z.enum(["literal", "regex"]).optional().describe("How to interpret pattern values where supported."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive matching where supported."),
    heading: z.preprocess(blank, z.string().optional()).describe("Heading text for section reads."),
    occurrence: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Heading occurrence for section reads."),
    max_level: z
      .preprocess(zero, z.coerce.number().int().min(1).max(6).optional())
      .describe("Optional heading level filter for outline or search."),
  })
  .strict()

export const InspectArchiveParametersSchema = z
  .object({
    action: z.literal("archive").describe("Inspection action to run."),
    filePath: z.preprocess(blank, z.string()).describe("Path to a supported archive file."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of archive entries to return."),
    pattern: z.preprocess(blank, z.string().optional()).describe("Optional entry filter pattern."),
    match: z.enum(["literal", "regex"]).optional().describe("How to interpret pattern values where supported."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive matching where supported."),
  })
  .strict()

export const InspectParametersSchema = z.preprocess(
  (input) =>
    sanitizeDiscriminatedInput(input, {
      discriminant: "action",
      allowed: inspectAllowed,
      strip: inspectInjectedDefaults,
    }),
  z.discriminatedUnion("action", [
    InspectFileParametersSchema,
    InspectDirParametersSchema,
    InspectTreeParametersSchema,
    InspectStructuredParametersSchema,
    InspectMarkdownParametersSchema,
    InspectArchiveParametersSchema,
  ]),
)

type InspectParameters = z.infer<typeof InspectParametersSchema>

function target(input: InspectParameters) {
  const item =
    ("filePath" in input ? input.filePath : undefined) ??
    ("path" in input ? input.path : undefined) ??
    Instance.directory
  return path.isAbsolute(item) ? item : path.resolve(Instance.directory, item)
}

export const InspectTool = Tool.defineEffect(
  "inspect",
  Effect.gen(function* () {
    const fileInfo = yield* FileTool

    return {
      description:
        "Unified local inspection tool. Choose exactly one action shape: file for numbered line reads, dir for one-level directory listings, tree for recursive structure, structured for JSON/JSONC/TOML queries, markdown for Markdown sections or frontmatter, and archive for archive entry inspection. Each action accepts only its own fields; mixed-field payloads are rejected so the caller can retry with a precise request.",
      parameters: InspectParametersSchema,
      async execute(input: InspectParameters, ctx: Tool.Context<Record<string, unknown>>) {
        const [file, tree, data, markdown, archive] = await Promise.all([
          Effect.runPromise(Tool.init(fileInfo)),
          DirTreeTool.init(),
          DataQueryTool.init(),
          MarkdownReadTool.init(),
          ArchiveListTool.init(),
        ])
        const out = target(input)
        await assertExternalDirectory(ctx, out, {
          bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
          kind: input.action === "dir" || input.action === "tree" ? "directory" : "file",
        })
        await ctx.ask({
          permission: "inspect",
          patterns: [out],
          always: ["*"],
          metadata: {
            action: input.action,
            path: "path" in input ? input.path : undefined,
            filePath: "filePath" in input ? input.filePath : undefined,
          },
        })

        const next = {
          ...ctx,
          ask: async () => {},
          metadata: ({ title, metadata }: { title?: string; metadata?: Record<string, unknown> }) =>
            ctx.metadata({ title, metadata }),
        }

        const result =
          input.action === "file"
            ? await file.execute(
                {
                  filePath: input.filePath!,
                  offset: input.offset,
                  limit: input.limit,
                },
                next,
              )
            : input.action === "dir"
              ? await file.execute(
                  {
                    filePath: input.path ?? Instance.directory,
                    offset: input.offset,
                    limit: input.limit,
                  },
                  next,
                )
              : input.action === "tree"
                ? await tree.execute(
                    {
                      path: input.path,
                      depth: input.depth ?? 4,
                      limit: input.limit ?? 200,
                      include: input.include,
                      ignore: input.ignore,
                      follow: input.follow,
                      dirs_only: input.dirs_only,
                      counts: input.counts,
                    },
                    next,
                  )
                : input.action === "structured"
                  ? await data.execute(
                      {
                        filePath: input.filePath!,
                        pointer: input.pointer,
                        mode: input.mode as "summary" | "get" | "keys" | "entries" | "slice" | "search" | undefined,
                        offset: input.offset ?? 0,
                        limit: input.limit ?? 50,
                        pattern: input.pattern,
                        match: input.match ?? "literal",
                        case_sensitive: input.case_sensitive ?? false,
                        scope: input.scope ?? "both",
                      },
                      next,
                    )
                  : input.action === "markdown"
                    ? await markdown.execute(
                        {
                          filePath: input.filePath!,
                          mode: input.mode as "outline" | "section" | "search" | "frontmatter" | undefined,
                          heading: input.heading,
                          occurrence: input.occurrence ?? 1,
                          pattern: input.pattern,
                          match: input.match ?? "literal",
                          case_sensitive: input.case_sensitive ?? false,
                          limit: input.limit ?? 50,
                          max_level: input.max_level,
                          pointer: input.pointer,
                        },
                        next,
                      )
                    : await archive.execute(
                        {
                          filePath: input.filePath!,
                          pattern: input.pattern,
                          match: input.match ?? "literal",
                          case_sensitive: input.case_sensitive ?? false,
                          limit: input.limit ?? 200,
                        },
                        next,
                      )

        return {
          ...result,
          metadata: {
            ...result.metadata,
            action: input.action,
          },
        }
      },
    }
  }),
)
