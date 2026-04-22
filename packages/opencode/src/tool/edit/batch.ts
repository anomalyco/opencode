import z from "zod"
import { Tool } from "../shared/tool"
import { blank, empty, zero } from "../shared/shape"
import { batchList, batchResult, type BatchOut } from "../shared/batch"
import { EditTool } from "./index"
import { WriteTool } from "./write"
import { ApplyPatchTool } from "./apply_patch"
import { PathEditTool } from "./path_edit"
import { WorkspaceReplaceTool } from "./workspace_replace"

const tools = ["edit", "write", "apply_patch", "path_edit", "workspace_replace"] as const

const EditStepSchema = z
  .object({
    filePath: z.preprocess(blank, z.string().optional()),
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict()

const PathOperationSchema = z
  .object({
    action: z.enum(["mkdir", "move", "copy", "delete", "rename"]),
    source: z.preprocess(blank, z.string().optional()),
    target: z.preprocess(blank, z.string().optional()),
    recursive: z.boolean().optional(),
    overwrite: z.boolean().optional(),
    create_parents: z.boolean().optional(),
  })
  .strict()

export const EditBatchCallSchema = z
  .object({
    tool: z.enum(tools),
    filePath: z.preprocess(blank, z.string().optional()).describe("File path for edit or write calls."),
    oldString: z.preprocess(blank, z.string().optional()).describe("Old text for edit or workspace_replace calls."),
    newString: z.preprocess(blank, z.string().optional()).describe("New text for edit or workspace_replace calls."),
    replaceAll: z.boolean().optional().describe("Replace all matches where supported."),
    edits: z.array(EditStepSchema).optional().describe("Sequential same-file edit steps for tool=edit."),
    mode: z.preprocess(blank, z.string().optional()).describe("Edit mode (data/frontmatter/markdown) or workspace_replace mode (literal/regex/identifier)."),
    action: z.preprocess(blank, z.string().optional()).describe("Structured edit action for tool=edit. Data/frontmatter accept set, delete, merge, append, prepend, insert, replace, or create; markdown accepts replace, append, prepend, delete, or create."),
    value: z
      .string()
      .optional()
      .describe("Structured edit value for tool=edit data/frontmatter modes. Pass plain text for strings or JSON text for booleans, numbers, arrays, objects, and null."),
    index: z.preprocess(zero, z.coerce.number().int().min(0).optional()).describe("Structured edit insertion index where supported."),
    pointer: z.preprocess(blank, z.string().optional()).describe("Structured edit pointer for data/frontmatter modes."),
    heading: z.preprocess(blank, z.string().optional()).describe("Markdown heading for tool=edit mode=markdown."),
    content: z.preprocess(blank, z.string().optional()).describe("Content for write or markdown edit create/replace operations."),
    create: z.boolean().optional().describe("Create missing targets where supported by structured edit modes."),
    position: z.preprocess(blank, z.string().optional()).describe("Markdown edit position hint where supported."),
    anchor: z.preprocess(blank, z.string().optional()).describe("Markdown anchor heading where supported."),
    level: z.preprocess(zero, z.coerce.number().int().min(1).max(6).optional()).describe("Markdown heading level where supported."),
    occurrence: z.preprocess(zero, z.coerce.number().int().min(1).optional()).describe("Markdown heading occurrence where supported."),
    anchor_occurrence: z.preprocess(zero, z.coerce.number().int().min(1).optional()).describe("Markdown anchor occurrence where supported."),
    patchText: z.preprocess(blank, z.string().optional()).describe("Patch text for tool=apply_patch."),
    operations: z.array(PathOperationSchema).optional().describe("Filesystem operations for tool=path_edit."),
    path: z.preprocess(blank, z.string().optional()).describe("Workspace root/subtree for tool=workspace_replace."),
    include: z.preprocess(empty, z.array(z.string()).optional()).describe("Include globs for workspace_replace."),
    exclude: z.preprocess(empty, z.array(z.string()).optional()).describe("Exclude globs for workspace_replace."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive matching for workspace_replace."),
    whole_word: z.boolean().optional().describe("Whole-word matching for workspace_replace."),
    dry_run: z.boolean().optional().describe("Preview-only mode for workspace_replace."),
    limit: z.preprocess(zero, z.coerce.number().int().min(1).max(500).optional()).describe("Workspace_replace file limit."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (value[key as keyof typeof value] != null) continue
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when tool=${value.tool}` })
      }
    }
    if (value.tool === "write") {
      need(["filePath", "content"])
      return
    }
    if (value.tool === "apply_patch") {
      need(["patchText"])
      return
    }
    if (value.tool === "path_edit") {
      if (!value.operations?.length) {
        ctx.addIssue({ code: "custom", path: ["operations"], message: "operations is required when tool=path_edit" })
      }
      return
    }
    if (value.tool === "workspace_replace") {
      need(["oldString", "newString"])
      return
    }
    need(["filePath"])
    if (value.edits?.length) return
    if (value.mode) return
    need(["oldString", "newString"])
  })

type Call = z.infer<typeof EditBatchCallSchema>

function coverage(item: Call) {
  const out = [item.filePath, item.path]
  if (item.operations?.length) {
    for (const op of item.operations) out.push(op.source, op.target)
  }
  return out.filter(Boolean) as string[]
}

function label(item: Call) {
  if (item.tool === "edit" && item.mode) return `${item.tool}:${item.mode}`
  return item.tool
}

function parse(value: string | undefined) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const EditBatchTool = Tool.define("edit_batch", async () => ({
  description:
    "Run multiple mutation calls across edit, write, apply_patch, path_edit, and workspace_replace in one ordered batch. This wrapper stays sequential, preserves each underlying tool's own approval/diff flow, and returns indexed structured results for multi-step edit plans.",
  parameters: z.object({
    calls: z.array(EditBatchCallSchema).min(1).max(16).describe("Ordered mutation calls to run sequentially in one batch."),
  }),
  async execute(input: { calls: Call[] }, ctx: Tool.Context<Record<string, unknown>>) {
    const needs = new Set(input.calls.map((item) => item.tool))
    const [edit, write, patch, pathEdit, workspaceReplace] = await Promise.all([
      needs.has("edit") ? EditTool.init() : Promise.resolve(undefined),
      needs.has("write") ? WriteTool.init() : Promise.resolve(undefined),
      needs.has("apply_patch") ? ApplyPatchTool.init() : Promise.resolve(undefined),
      needs.has("path_edit") ? PathEditTool.init() : Promise.resolve(undefined),
      needs.has("workspace_replace") ? WorkspaceReplaceTool.init() : Promise.resolve(undefined),
    ])

    const rows: Array<{ tool: Call["tool"]; mode?: string; out: BatchOut }> = []

    for (const [i, item] of input.calls.entries()) {
      try {
        const out: BatchOut =
          item.tool === "edit"
            ? await edit!.execute(
                item.edits?.length
                  ? {
                      filePath: item.filePath!,
                      replaceAll: item.replaceAll,
                      edits: item.edits,
                    }
                  : item.mode
                    ? {
                        mode: item.mode as "data" | "frontmatter" | "markdown",
                        filePath: item.filePath!,
                        pointer: item.pointer,
                        action: item.action as any,
                        value: parse(item.value),
                        index: item.index,
                        heading: item.heading!,
                        content: item.content,
                        create: item.create,
                        position: item.position as any,
                        anchor: item.anchor,
                        level: item.level,
                        occurrence: item.occurrence,
                        anchor_occurrence: item.anchor_occurrence,
                      }
                    : {
                        filePath: item.filePath!,
                        oldString: item.oldString!,
                        newString: item.newString!,
                        replaceAll: item.replaceAll,
                      },
                ctx,
              )
            : item.tool === "write"
              ? await write!.execute(
                  {
                    filePath: item.filePath!,
                    content: item.content!,
                  },
                  ctx,
                )
              : item.tool === "apply_patch"
                ? await patch!.execute(
                    {
                      patchText: item.patchText!,
                    },
                    ctx,
                  )
                : item.tool === "path_edit"
                  ? await pathEdit!.execute(
                      {
                        operations: item.operations!,
                      },
                      ctx,
                    )
                  : await workspaceReplace!.execute(
                      {
                        oldString: item.oldString!,
                        newString: item.newString!,
                        path: item.path,
                        include: item.include,
                        exclude: item.exclude,
                        mode: (item.mode as "literal" | "regex" | "identifier" | undefined) ?? "literal",
                        case_sensitive: item.case_sensitive ?? true,
                        whole_word: item.whole_word,
                        replaceAll: item.replaceAll ?? true,
                        dry_run: item.dry_run,
                        limit: item.limit ?? 100,
                      },
                      ctx,
                    )
        rows.push({ tool: item.tool, mode: item.mode, out })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        throw new Error(`edit_batch step ${i + 1} (${label(item)}) failed: ${msg}`)
      }
    }

    return batchResult({
      title: `edit batch (${rows.length})`,
      rows,
      mode: "sequential",
      coverage: batchList(input.calls.flatMap(coverage)),
      call: (item) => ({
        tool: item.tool,
        mode: item.mode,
      }),
      result: (item) => ({
        tool: item.tool,
        mode: item.mode,
      }),
      label: (_, i) => `${label(input.calls[i]!)} — ${rows[i]!.out.title}`,
      include_attachments: true,
      include_attachment_counts: true,
    })
  },
}))
