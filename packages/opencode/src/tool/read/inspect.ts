import path from "path"
import z from "zod"
import { Effect } from "effect"
import { Tool } from "../shared/tool"
import { Instance } from "../../project/instance"
import { FileTool } from "./internal/file"
import { assertExternalDirectory } from "../external-directory"
import { blank, empty, zero } from "../shared/shape"
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
const inspectModes = ["summary", "get", "keys", "entries", "slice", "search", "outline", "section", "frontmatter"] as const

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

function pickPresent(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function addIssues(ctx: z.RefinementCtx, error: z.ZodError) {
  for (const issue of error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue.path,
      message: issue.message,
    })
  }
}

export const InspectParametersSchema = z
  .object({
    action: z.enum(["file", "dir", "tree", "structured", "markdown", "archive"]).describe("Inspection action to run."),
    filePath: z.preprocess(blank, z.string().optional()).describe("Optional file path for file-based inspection actions."),
    path: z.preprocess(blank, z.string().optional()).describe("Optional directory path for directory-based inspection actions."),
    offset: z
      .preprocess(zero, z.coerce.number().int().min(0).optional())
      .describe("Optional 1-based starting line or entry offset where supported."),
    limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of returned rows, entries, or matches where supported."),
    include: z.preprocess(empty, z.array(z.string()).optional()).describe("Optional include globs for tree reads."),
    ignore: z.preprocess(empty, z.array(z.string()).optional()).describe("Optional ignore globs for tree reads."),
    depth: z
      .preprocess(zero, z.coerce.number().int().min(1).max(12).optional())
      .describe("Optional maximum directory depth for tree reads."),
    follow: z.boolean().optional().describe("Optional symlink following for tree reads."),
    dirs_only: z.boolean().optional().describe("Optional directory-only mode for tree reads."),
    counts: z.boolean().optional().describe("Optional per-directory counts for tree reads."),
    mode: z.enum(inspectModes).optional().describe("Optional sub-mode for structured or markdown inspection."),
    pointer: z.preprocess(blank, z.string().optional()).describe("Optional JSON Pointer for structured or markdown reads."),
    pattern: z.preprocess(blank, z.string().optional()).describe("Optional search pattern for supported actions."),
    match: z.enum(["literal", "regex"]).optional().describe("Optional pattern interpretation for supported actions."),
    case_sensitive: z.boolean().optional().describe("Optional case sensitivity flag for supported actions."),
    scope: z.enum(["keys", "values", "both"]).optional().describe("Optional structured search scope."),
    heading: z.preprocess(blank, z.string().optional()).describe("Optional heading text for markdown section reads."),
    occurrence: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Optional heading occurrence for markdown section reads."),
    max_level: z
      .preprocess(zero, z.coerce.number().int().min(1).max(6).optional())
      .describe("Optional heading level filter for markdown outline or search."),
  })
  .strict()
  .superRefine((input, ctx) => {
    const allowed = new Set<string>(["action", ...inspectAllowed[input.action]])
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || allowed.has(key)) continue
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is not allowed when action=${input.action}`,
      })
    }

    const next = pickPresent(input)
    const parsed =
      input.action === "file"
        ? InspectFileParametersSchema.safeParse(next)
        : input.action === "dir"
          ? InspectDirParametersSchema.safeParse(next)
          : input.action === "tree"
            ? InspectTreeParametersSchema.safeParse(next)
            : input.action === "structured"
              ? InspectStructuredParametersSchema.safeParse(next)
              : input.action === "markdown"
                ? InspectMarkdownParametersSchema.safeParse(next)
                : InspectArchiveParametersSchema.safeParse(next)
    if (!parsed.success) addIssues(ctx, parsed.error)
  })

type InspectParameters = z.infer<typeof InspectParametersSchema>
type InspectInput =
  | z.infer<typeof InspectFileParametersSchema>
  | z.infer<typeof InspectDirParametersSchema>
  | z.infer<typeof InspectTreeParametersSchema>
  | z.infer<typeof InspectStructuredParametersSchema>
  | z.infer<typeof InspectMarkdownParametersSchema>
  | z.infer<typeof InspectArchiveParametersSchema>

function parseInspectInput(input: InspectParameters): InspectInput {
  const next = pickPresent(input)
  if (input.action === "file") return InspectFileParametersSchema.parse(next)
  if (input.action === "dir") return InspectDirParametersSchema.parse(next)
  if (input.action === "tree") return InspectTreeParametersSchema.parse(next)
  if (input.action === "structured") return InspectStructuredParametersSchema.parse(next)
  if (input.action === "markdown") return InspectMarkdownParametersSchema.parse(next)
  return InspectArchiveParametersSchema.parse(next)
}

function target(input: InspectInput) {
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
        const nextInput = parseInspectInput(input)
        const [file, tree, data, markdown, archive] = await Promise.all([
          Effect.runPromise(Tool.init(fileInfo)),
          DirTreeTool.init(),
          DataQueryTool.init(),
          MarkdownReadTool.init(),
          ArchiveListTool.init(),
        ])
        const out = target(nextInput)
        await assertExternalDirectory(ctx, out, {
          bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
          kind: nextInput.action === "dir" || nextInput.action === "tree" ? "directory" : "file",
        })
        await ctx.ask({
          permission: "inspect",
          patterns: [out],
          always: ["*"],
          metadata: {
            action: nextInput.action,
            path: "path" in nextInput ? nextInput.path : undefined,
            filePath: "filePath" in nextInput ? nextInput.filePath : undefined,
          },
        })

        const next = {
          ...ctx,
          ask: async () => {},
          metadata: ({ title, metadata }: { title?: string; metadata?: Record<string, unknown> }) =>
            ctx.metadata({ title, metadata }),
        }

        const result =
          nextInput.action === "file"
            ? await file.execute(
                {
                  filePath: nextInput.filePath,
                  offset: nextInput.offset,
                  limit: nextInput.limit,
                },
                next,
              )
            : nextInput.action === "dir"
              ? await file.execute(
                  {
                    filePath: nextInput.path ?? Instance.directory,
                    offset: nextInput.offset,
                    limit: nextInput.limit,
                  },
                  next,
                )
              : nextInput.action === "tree"
                ? await tree.execute(
                    {
                      path: nextInput.path,
                      depth: nextInput.depth ?? 4,
                      limit: nextInput.limit ?? 200,
                      include: nextInput.include,
                      ignore: nextInput.ignore,
                      follow: nextInput.follow,
                      dirs_only: nextInput.dirs_only,
                      counts: nextInput.counts,
                    },
                    next,
                  )
                : nextInput.action === "structured"
                  ? await data.execute(
                      {
                        filePath: nextInput.filePath,
                        pointer: nextInput.pointer,
                        mode: nextInput.mode,
                        offset: nextInput.offset ?? 0,
                        limit: nextInput.limit ?? 50,
                        pattern: nextInput.pattern,
                        match: nextInput.match ?? "literal",
                        case_sensitive: nextInput.case_sensitive ?? false,
                        scope: nextInput.scope ?? "both",
                      },
                      next,
                    )
                  : nextInput.action === "markdown"
                    ? await markdown.execute(
                        {
                          filePath: nextInput.filePath,
                          mode: nextInput.mode,
                          heading: nextInput.heading,
                          occurrence: nextInput.occurrence ?? 1,
                          pattern: nextInput.pattern,
                          match: nextInput.match ?? "literal",
                          case_sensitive: nextInput.case_sensitive ?? false,
                          limit: nextInput.limit ?? 50,
                          max_level: nextInput.max_level,
                          pointer: nextInput.pointer,
                        },
                        next,
                      )
                    : await archive.execute(
                        {
                          filePath: nextInput.filePath,
                          pattern: nextInput.pattern,
                          match: nextInput.match ?? "literal",
                          case_sensitive: nextInput.case_sensitive ?? false,
                          limit: nextInput.limit ?? 200,
                        },
                        next,
                      )

        return {
          ...result,
          metadata: {
            ...result.metadata,
            action: nextInput.action,
          },
        }
      },
    }
  }),
)
