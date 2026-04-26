// patch_file tool — hash-anchored surgical edits without full-file context
// Inspired by Dirac's Hash-Anchored Parallel Edits technique.
// See: https://github.com/anomalyco/opencode/issues/24511

import * as path from "path"
import * as crypto from "crypto"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch, diffLines } from "diff"
import DESCRIPTION from "./patch_file.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Bom from "@/util/bom"
import { trimDiff } from "./edit"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const PatchSchema = Schema.Struct({
  anchor_hash: Schema.String.annotate({
    description:
      "SHA-256 hash of the context window around the target section. " +
      "Obtain via compute_anchors=true first. DO NOT guess this value.",
  }),
  context_lines: Schema.optional(Schema.Number).annotate({
    description: "Lines of surrounding context included in the anchor hash (default 5). " +
      "Must match the value used when computing anchors.",
  }),
  search: Schema.String.annotate({
    description: "Exact lines to find within the anchored window (indentation-sensitive).",
  }),
  replace: Schema.String.annotate({
    description: "Replacement text for the matched lines.",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute path to the file to modify." }),
  patches: Schema.optional(Schema.Array(PatchSchema)).annotate({
    description:
      "One or more patches. Each targets an independent section identified by its anchor_hash. " +
      "Patches must not overlap. All patches apply atomically.",
  }),
  compute_anchors: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, returns anchor hashes for every line without modifying the file. " +
      "Use this to obtain anchor_hash values before calling with patches.",
  }),
})

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

function computeAnchor(lines: string[], centerLine: number, contextLines: number): string {
  const from = Math.max(0, centerLine - contextLines)
  const to   = Math.min(lines.length - 1, centerLine + contextLines)
  const window = lines.slice(from, to + 1).join("\n")
  return crypto.createHash("sha256").update(window).digest("hex")
}

interface AnchorInfo {
  anchor_hash:   string
  line:          number
  context_lines: number
  preview:       string
}

function buildAnchorMap(content: string, contextLines: number): AnchorInfo[] {
  const lines = content.split("\n")
  return lines.map((line, i) => ({
    anchor_hash:   computeAnchor(lines, i, contextLines),
    line:          i,
    context_lines: contextLines,
    preview:       line.slice(0, 80),
  }))
}

// ---------------------------------------------------------------------------
// Patch resolution
// ---------------------------------------------------------------------------

interface ResolvedPatch {
  startLine:    number
  endLine:      number
  search:       string
  replace:      string
}

function resolvePatch(
  lines: string[],
  patch: Schema.Schema.Type<typeof PatchSchema>,
): ResolvedPatch | null {
  const ctxLines = patch.context_lines ?? 5
  for (let i = 0; i < lines.length; i++) {
    if (computeAnchor(lines, i, ctxLines) !== patch.anchor_hash) continue
    const from = Math.max(0, i - ctxLines)
    const to   = Math.min(lines.length - 1, i + ctxLines)
    const windowText = lines.slice(from, to + 1).join("\n")
    if (!windowText.includes(patch.search)) return null
    return { startLine: from, endLine: to, search: patch.search, replace: patch.replace }
  }
  return null
}

function applyPatches(content: string, resolved: ResolvedPatch[]): string {
  // Apply in reverse line order to prevent offset drift
  const sorted = [...resolved].sort((a, b) => b.startLine - a.startLine)
  let result = content
  for (const p of sorted) {
    const lines = result.split("\n")
    const windowText = lines.slice(p.startLine, p.endLine + 1).join("\n")
    if (!windowText.includes(p.search)) {
      throw new Error(
        `patch_file: search text not found in anchor window (lines ${p.startLine}–${p.endLine}). ` +
          "Re-run with compute_anchors=true to refresh anchors.",
      )
    }
    const patched  = windowText.replace(p.search, p.replace)
    const newLines = patched.split("\n")
    lines.splice(p.startLine, p.endLine - p.startLine + 1, ...newLines)
    result = lines.join("\n")
  }
  return result
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const PatchFileTool = Tool.define(
  "patch_file",
  Effect.gen(function* () {
    const lsp    = yield* LSP.Service
    const afs    = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus    = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters:  Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)

          const source  = yield* Bom.readFile(afs, filePath)
          const content = source.text

          // ---- compute_anchors mode (read-only) ----
          if (params.compute_anchors) {
            const anchors = buildAnchorMap(content, 5)
            return {
              title:    `Anchors for ${path.relative(Instance.worktree, filePath)}`,
              output:   JSON.stringify(anchors, null, 2),
              metadata: { anchors },
            }
          }

          const patches = params.patches
          if (!patches || patches.length === 0) {
            throw new Error("patches array is required when compute_anchors is not set.")
          }

          // ---- resolve all patches ----
          const lines = content.split("\n")
          const resolved: ResolvedPatch[] = []

          for (const patch of patches) {
            const r = resolvePatch(lines, patch)
            if (!r) {
              throw new Error(
                `patch_file: anchor_hash "${patch.anchor_hash}" not found in ` +
                  `${path.relative(Instance.worktree, filePath)}. ` +
                  "The file may have changed — re-run with compute_anchors=true.",
              )
            }
            resolved.push(r)
          }

          // ---- overlap check ----
          const sortedR = [...resolved].sort((a, b) => a.startLine - b.startLine)
          for (let i = 1; i < sortedR.length; i++) {
            if (sortedR[i].startLine <= sortedR[i - 1].endLine) {
              throw new Error(
                `patch_file: patches overlap at lines ${sortedR[i - 1].startLine}–${sortedR[i - 1].endLine} ` +
                  `and ${sortedR[i].startLine}–${sortedR[i].endLine}. Patches must target non-overlapping sections.`,
              )
            }
          }

          const contentNew = applyPatches(content, resolved)
          const diff       = trimDiff(createTwoFilesPatch(filePath, filePath, content, contentNew))

          yield* ctx.ask({
            permission: "edit",
            patterns:   [path.relative(Instance.worktree, filePath)],
            always:     ["*"],
            metadata:   { filepath: filePath, diff },
          })

          const next       = Bom.split(contentNew)
          const desiredBom = source.bom || next.bom
          yield* afs.writeWithDirs(filePath, Bom.join(next.text, desiredBom))

          if (yield* format.file(filePath)) {
            yield* Bom.syncFile(afs, filePath, desiredBom)
          }
          yield* bus.publish(File.Event.Edited,        { file: filePath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })

          let additions = 0
          let deletions = 0
          for (const change of diffLines(content, contentNew)) {
            if (change.added)   additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }
          const filediff: Snapshot.FileDiff = { file: filePath, patch: diff, additions, deletions }

          yield* ctx.metadata({ metadata: { diff, filediff, diagnostics: {} } })

          let output = `Applied ${patches.length} patch${patches.length > 1 ? "es" : ""} successfully.`

          yield* lsp.touchFile(filePath, "document")
          const diagnostics         = yield* lsp.diagnostics()
          const normalizedFilePath  = AppFileSystem.normalizePath(filePath)
          const block               = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected, please fix:\n${block}`

          return {
            metadata: { diagnostics, diff, filediff },
            title:    `${path.relative(Instance.worktree, filePath)} (${patches.length} patch${patches.length > 1 ? "es" : ""})`,
            output,
          }
        }),
    }
  }),
)
