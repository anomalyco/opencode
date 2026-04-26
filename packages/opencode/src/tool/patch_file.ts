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
      "Computed automatically by first calling read_file; DO NOT guess this value. " +
      "The tool returns anchors when you call it with compute_anchors=true.",
  }),
  context_lines: Schema.optional(Schema.Number).annotate({
    description: "Number of lines of surrounding context included in the anchor hash (default 5).",
  }),
  search: Schema.String.annotate({
    description: "The exact lines to find within the anchored section (must match exactly, including indentation).",
  }),
  replace: Schema.String.annotate({
    description: "The replacement text for the matched lines.",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Absolute path to the file to modify." }),
  patches: Schema.Array(PatchSchema).annotate({
    description:
      "One or more patches to apply. Each patch targets an independent code section " +
      "identified by its anchor hash. Patches must not overlap. " +
      "All patches are applied in a single atomic operation.",
  }),
  compute_anchors: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, the tool reads the file and returns anchor hashes for every N-line window " +
      "without making any changes. Use this to obtain anchor_hash values before patching.",
  }),
})

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

function computeAnchor(lines: string[], centerStart: number, centerEnd: number, contextLines: number): string {
  const from = Math.max(0, centerStart - contextLines)
  const to = Math.min(lines.length - 1, centerEnd + contextLines)
  const window = lines.slice(from, to + 1).join("\n")
  return crypto.createHash("sha256").update(window).digest("hex")
}

interface AnchorInfo {
  anchor_hash: string
  start_line: number
  end_line: number
  context_lines: number
  preview: string
}

function buildAnchorMap(content: string, contextLines: number): AnchorInfo[] {
  const lines = content.split("\n")
  const anchors: AnchorInfo[] = []
  // Slide a window of `contextLines*2+1` lines across the file
  for (let i = 0; i < lines.length; i++) {
    const hash = computeAnchor(lines, i, i, contextLines)
    anchors.push({
      anchor_hash: hash,
      start_line: i,
      end_line: i,
      context_lines: contextLines,
      preview: lines[i].slice(0, 80),
    })
  }
  return anchors
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

interface ResolvedPatch {
  startLine: number
  endLine: number
  search: string
  replace: string
  contextLines: number
}

function resolvePatch(
  lines: string[],
  patch: Schema.Schema.Type<typeof PatchSchema>,
): ResolvedPatch | null {
  const ctxLines = patch.context_lines ?? 5
  // Scan all possible center positions and compare anchor hash
  for (let i = 0; i < lines.length; i++) {
    const candidate = computeAnchor(lines, i, i, ctxLines)
    if (candidate === patch.anchor_hash) {
      // Found anchor — now locate search string in the context window
      const from = Math.max(0, i - ctxLines)
      const to = Math.min(lines.length - 1, i + ctxLines)
      const windowText = lines.slice(from, to + 1).join("\n")
      if (windowText.includes(patch.search)) {
        return { startLine: from, endLine: to, search: patch.search, replace: patch.replace, contextLines: ctxLines }
      }
      return null
    }
  }
  return null
}

function applyPatches(content: string, resolved: ResolvedPatch[]): string {
  // Sort patches in reverse order to avoid offset drift
  const sorted = [...resolved].sort((a, b) => b.startLine - a.startLine)
  let result = content
  for (const p of sorted) {
    const lines = result.split("\n")
    const windowLines = lines.slice(p.startLine, p.endLine + 1)
    const windowText = windowLines.join("\n")
    if (!windowText.includes(p.search)) {
      throw new Error(
        `patch_file: search text not found in anchor window at lines ${p.startLine}-${p.endLine}. ` +
          "Re-run with compute_anchors=true to refresh anchor hashes.",
      )
    }
    const patched = windowText.replace(p.search, p.replace)
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
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.filePath) throw new Error("filePath is required")

          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(Instance.directory, params.filePath)
          yield* assertExternalDirectoryEffect(ctx, filePath)

          const source = yield* Bom.readFile(afs, filePath)
          const content = source.text

          // ---- compute_anchors mode: return anchor map, no changes ----
          if (params.compute_anchors) {
            const contextLines = params.patches?.[0]?.context_lines ?? 5
            const anchors = buildAnchorMap(content, contextLines)
            return {
              title: `Anchors for ${path.relative(Instance.worktree, filePath)}`,
              output: JSON.stringify(anchors, null, 2),
              metadata: { anchors },
            }
          }

          if (!params.patches || params.patches.length === 0) {
            throw new Error("patches array is required when compute_anchors is not set.")
          }

          // ---- resolve all patches (with one retry on mismatch) ----
          const lines = content.split("\n")
          let resolved: ResolvedPatch[] = []

          for (const patch of params.patches) {
            let r = resolvePatch(lines, patch)
            if (!r) {
              throw new Error(
                `patch_file: anchor_hash "${patch.anchor_hash}" not found in ${path.relative(Instance.worktree, filePath)}. ` +
                  "The file may have changed. Re-run with compute_anchors=true to obtain fresh anchors.",
              )
            }
            resolved.push(r)
          }

          // Detect overlapping patches
          const sortedResolved = [...resolved].sort((a, b) => a.startLine - b.startLine)
          for (let i = 1; i < sortedResolved.length; i++) {
            if (sortedResolved[i].startLine <= sortedResolved[i - 1].endLine) {
              throw new Error(
                `patch_file: patches overlap at lines ${sortedResolved[i - 1].startLine}-${sortedResolved[i - 1].endLine} ` +
                  `and ${sortedResolved[i].startLine}-${sortedResolved[i].endLine}. Patches must target non-overlapping sections.`,
              )
            }
          }

          const contentNew = applyPatches(content, resolved)

          const diff = trimDiff(createTwoFilesPatch(filePath, filePath, content, contentNew))

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(Instance.worktree, filePath)],
            always: ["*"],
            metadata: { filepath: filePath, diff },
          })

          const next = Bom.split(contentNew)
          const desiredBom = source.bom || next.bom
          yield* afs.writeWithDirs(filePath, Bom.join(next.text, desiredBom))

          if (yield* format.file(filePath)) {
            yield* Bom.syncFile(afs, filePath, desiredBom)
          }
          yield* bus.publish(File.Event.Edited, { file: filePath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })

          let additions = 0
          let deletions = 0
          for (const change of diffLines(content, contentNew)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }
          const filediff: Snapshot.FileDiff = { file: filePath, patch: diff, additions, deletions }

          yield* ctx.metadata({ metadata: { diff, filediff, diagnostics: {} } })

          let output = `Applied ${params.patches.length} patch(es) successfully.`
          yield* lsp.touchFile(filePath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            metadata: { diagnostics, diff, filediff },
            title: `${path.relative(Instance.worktree, filePath)} (${params.patches.length} patch${params.patches.length > 1 ? "es" : ""})`,
            output,
          }
        }),
    }
  }),
)
