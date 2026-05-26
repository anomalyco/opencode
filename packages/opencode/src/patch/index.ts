import { Effect, Schema } from "effect"
import * as path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import * as Bom from "../util/bom"

const log = Log.create({ service: "patch" })

export const PatchSchema = Schema.Struct({
  patchText: Schema.String.annotate({ description: "The full patch text that describes all changes to be made" }),
})

export type PatchParams = Schema.Schema.Type<typeof PatchSchema>

// Core types matching the Rust implementation
export interface ApplyPatchArgs {
  patch: string
  hunks: Hunk[]
  workdir?: string
}

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; move_path?: string; chunks: UpdateFileChunk[] }

export interface UpdateFileChunk {
  old_lines: string[]
  new_lines: string[]
  change_context?: string
  is_end_of_file?: boolean
}

export interface ApplyPatchAction {
  changes: Map<string, ApplyPatchFileChange>
  patch: string
  cwd: string
}

export type ApplyPatchFileChange =
  | { type: "add"; content: string }
  | { type: "delete"; content: string }
  | { type: "update"; unified_diff: string; move_path?: string; new_content: string }

export interface AffectedPaths {
  added: string[]
  modified: string[]
  deleted: string[]
}

export enum ApplyPatchError {
  ParseError = "ParseError",
  IoError = "IoError",
  ComputeReplacements = "ComputeReplacements",
  ImplicitInvocation = "ImplicitInvocation",
}

export enum MaybeApplyPatch {
  Body = "Body",
  ShellParseError = "ShellParseError",
  PatchParseError = "PatchParseError",
  NotApplyPatch = "NotApplyPatch",
}

export enum MaybeApplyPatchVerified {
  Body = "Body",
  ShellParseError = "ShellParseError",
  CorrectnessError = "CorrectnessError",
  NotApplyPatch = "NotApplyPatch",
}

// Parser implementation
function parsePatchHeader(
  lines: string[],
  startIdx: number,
): { filePath: string; movePath?: string; nextIdx: number } | null {
  const line = lines[startIdx]

  if (line.startsWith("*** Add File:")) {
    const filePath = line.slice("*** Add File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Delete File:")) {
    const filePath = line.slice("*** Delete File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Update File:")) {
    const filePath = line.slice("*** Update File:".length).trim()
    let movePath: string | undefined
    let nextIdx = startIdx + 1

    // Check for move directive
    if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
      movePath = lines[nextIdx].slice("*** Move to:".length).trim()
      nextIdx++
    }

    return filePath ? { filePath, movePath, nextIdx } : null
  }

  return null
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
  const chunks: UpdateFileChunk[] = []
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("@@")) {
      // Parse context line
      const contextLine = lines[i].substring(2).trim()
      i++

      const oldLines: string[] = []
      const newLines: string[] = []
      let isEndOfFile = false

      // Parse change lines
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
        const changeLine = lines[i]

        if (changeLine === "*** End of File") {
          isEndOfFile = true
          i++
          break
        }

        if (changeLine.startsWith(" ")) {
          // Keep line - appears in both old and new
          const content = changeLine.substring(1)
          oldLines.push(content)
          newLines.push(content)
        } else if (changeLine.startsWith("-")) {
          // Remove line - only in old
          oldLines.push(changeLine.substring(1))
        } else if (changeLine.startsWith("+")) {
          // Add line - only in new
          newLines.push(changeLine.substring(1))
        }

        i++
      }

      chunks.push({
        old_lines: oldLines,
        new_lines: newLines,
        change_context: contextLine || undefined,
        is_end_of_file: isEndOfFile || undefined,
      })
    } else {
      i++
    }
  }

  return { chunks, nextIdx: i }
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = ""
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("+")) {
      content += lines[i].substring(1) + "\n"
    }
    i++
  }

  // Remove trailing newline
  if (content.endsWith("\n")) {
    content = content.slice(0, -1)
  }

  return { content, nextIdx: i }
}

function stripHeredoc(input: string): string {
  // Match heredoc patterns like: cat <<'EOF'\n...\nEOF or <<EOF\n...\nEOF
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
  if (heredocMatch) {
    return heredocMatch[2]
  }
  return input
}

export function parsePatch(patchText: string): { hunks: Hunk[] } {
  const cleaned = stripHeredoc(patchText.trim())
  const lines = cleaned.split("\n")
  const hunks: Hunk[] = []
  let i = 0

  // Look for Begin/End patch markers
  const beginMarker = "*** Begin Patch"
  const endMarker = "*** End Patch"

  const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
  const endIdx = lines.findIndex((line) => line.trim() === endMarker)

  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers")
  }

  // Parse content between markers
  i = beginIdx + 1

  while (i < endIdx) {
    const header = parsePatchHeader(lines, i)
    if (!header) {
      i++
      continue
    }

    if (lines[i].startsWith("*** Add File:")) {
      const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
      hunks.push({
        type: "add",
        path: header.filePath,
        contents: content,
      })
      i = nextIdx
    } else if (lines[i].startsWith("*** Delete File:")) {
      hunks.push({
        type: "delete",
        path: header.filePath,
      })
      i = header.nextIdx
    } else if (lines[i].startsWith("*** Update File:")) {
      const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
      hunks.push({
        type: "update",
        path: header.filePath,
        move_path: header.movePath,
        chunks,
      })
      i = nextIdx
    } else {
      i++
    }
  }

  return { hunks }
}

// Apply patch functionality
export function maybeParseApplyPatch(
  argv: string[],
):
  | { type: MaybeApplyPatch.Body; args: ApplyPatchArgs }
  | { type: MaybeApplyPatch.PatchParseError; error: Error }
  | { type: MaybeApplyPatch.NotApplyPatch } {
  const APPLY_PATCH_COMMANDS = ["apply_patch", "applypatch"]

  // Direct invocation: apply_patch <patch>
  if (argv.length === 2 && APPLY_PATCH_COMMANDS.includes(argv[0])) {
    try {
      const { hunks } = parsePatch(argv[1])
      return {
        type: MaybeApplyPatch.Body,
        args: {
          patch: argv[1],
          hunks,
        },
      }
    } catch (error) {
      return {
        type: MaybeApplyPatch.PatchParseError,
        error: error as Error,
      }
    }
  }

  // Bash heredoc form: bash -lc 'apply_patch <<"EOF" ...'
  if (argv.length === 3 && argv[0] === "bash" && argv[1] === "-lc") {
    // Simple extraction - in real implementation would need proper bash parsing
    const script = argv[2]
    const heredocMatch = script.match(/apply_patch\s*<<['"](\w+)['"]\s*\n([\s\S]*?)\n\1/)

    if (heredocMatch) {
      const patchContent = heredocMatch[2]
      try {
        const { hunks } = parsePatch(patchContent)
        return {
          type: MaybeApplyPatch.Body,
          args: {
            patch: patchContent,
            hunks,
          },
        }
      } catch (error) {
        return {
          type: MaybeApplyPatch.PatchParseError,
          error: error as Error,
        }
      }
    }
  }

  return { type: MaybeApplyPatch.NotApplyPatch }
}

// File content manipulation
interface ApplyPatchFileUpdate {
  unified_diff: string
  content: string
  bom: boolean
}

export function deriveNewContentsFromChunks(
  filePath: string,
  chunks: UpdateFileChunk[],
  originalText: string,
): ApplyPatchFileUpdate {
  const originalContent = Bom.split(originalText)

  let originalLines = originalContent.text.split("\n")

  // Drop trailing empty element for consistent line counting
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop()
  }

  const replacements = computeReplacements(originalLines, filePath, chunks)
  let newLines = applyReplacements(originalLines, replacements)

  // Ensure trailing newline
  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines.push("")
  }

  const next = Bom.split(newLines.join("\n"))
  const newContent = next.text

  // Generate unified diff
  const unifiedDiff = generateUnifiedDiff(originalContent.text, newContent)

  return {
    unified_diff: unifiedDiff,
    content: newContent,
    bom: originalContent.bom || next.bom,
  }
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = []
  let lineIndex = 0

  for (const chunk of chunks) {
    // Handle context-based seeking
    if (chunk.change_context) {
      const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex)
      if (contextIdx === -1) {
        throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`)
      }
      lineIndex = contextIdx + 1
    }

    // Handle pure addition (no old lines)
    if (chunk.old_lines.length === 0) {
      const insertionIdx =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length
      replacements.push([insertionIdx, 0, chunk.new_lines])
      continue
    }

    // Try to match old lines in the file
    let pattern = chunk.old_lines
    let newSlice = chunk.new_lines
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)

    // Retry without trailing empty line if not found
    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1)
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1)
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file)
    }

    if (found !== -1) {
      replacements.push([found, pattern.length, newSlice])
      lineIndex = found + pattern.length
    } else {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`)
    }
  }

  // Sort replacements by index to apply in order
  replacements.sort((a, b) => a[0] - b[0])

  return replacements
}

function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
  // Apply replacements in reverse order to avoid index shifting
  const result = [...lines]

  for (let i = replacements.length - 1; i >= 0; i--) {
    const [startIdx, oldLen, newSegment] = replacements[i]

    // Remove old lines
    result.splice(startIdx, oldLen)

    // Insert new lines
    for (let j = 0; j < newSegment.length; j++) {
      result.splice(startIdx + j, 0, newSegment[j])
    }
  }

  return result
}

// Normalize Unicode punctuation to ASCII equivalents (like Rust's normalize_unicode)
function normalizeUnicode(str: string): string {
  return str
    .replace(/[‘’‚‛]/g, "'") // single quotes
    .replace(/[“”„‟]/g, '"') // double quotes
    .replace(/[‐‑‒–—―]/g, "-") // dashes
    .replace(/…/g, "...") // ellipsis
    .replace(/ /g, " ") // non-breaking space
}

type Comparator = (a: string, b: string) => boolean

function tryMatch(lines: string[], pattern: string[], startIndex: number, compare: Comparator, eof: boolean): number {
  // If EOF anchor, try matching from end of file first
  if (eof) {
    const fromEnd = lines.length - pattern.length
    if (fromEnd >= startIndex) {
      let matches = true
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[fromEnd + j], pattern[j])) {
          matches = false
          break
        }
      }
      if (matches) return fromEnd
    }
  }

  // Forward search from startIndex
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[i + j], pattern[j])) {
        matches = false
        break
      }
    }
    if (matches) return i
  }

  return -1
}

function seekSequence(lines: string[], pattern: string[], startIndex: number, eof = false): number {
  if (pattern.length === 0) return -1

  // Pass 1: exact match
  const exact = tryMatch(lines, pattern, startIndex, (a, b) => a === b, eof)
  if (exact !== -1) return exact

  // Pass 2: rstrip (trim trailing whitespace)
  const rstrip = tryMatch(lines, pattern, startIndex, (a, b) => a.trimEnd() === b.trimEnd(), eof)
  if (rstrip !== -1) return rstrip

  // Pass 3: trim (both ends)
  const trim = tryMatch(lines, pattern, startIndex, (a, b) => a.trim() === b.trim(), eof)
  if (trim !== -1) return trim

  // Pass 4: normalized (Unicode punctuation to ASCII)
  const normalized = tryMatch(
    lines,
    pattern,
    startIndex,
    (a, b) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
    eof,
  )
  return normalized
}

function generateUnifiedDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  // Simple diff generation - in a real implementation you'd use a proper diff algorithm
  let diff = "@@ -1 +1 @@\n"

  // Find changes (simplified approach)
  const maxLen = Math.max(oldLines.length, newLines.length)
  let hasChanges = false

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || ""
    const newLine = newLines[i] || ""

    if (oldLine !== newLine) {
      if (oldLine) diff += `-${oldLine}\n`
      if (newLine) diff += `+${newLine}\n`
      hasChanges = true
    } else if (oldLine) {
      diff += ` ${oldLine}\n`
    }
  }

  return hasChanges ? diff : ""
}

// Apply hunks to filesystem
export const applyHunksToFiles = Effect.fn("Patch.applyHunksToFiles")(function* (hunks: Hunk[]) {
  if (hunks.length === 0) {
    return yield* Effect.fail(new Error("No files were modified."))
  }

  const fs = yield* AppFileSystem.Service

  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  for (const hunk of hunks) {
    switch (hunk.type) {
      case "add": {
        yield* fs.writeWithDirs(hunk.path, hunk.contents)
        added.push(hunk.path)
        log.info(`Added file: ${hunk.path}`)
        break
      }

      case "delete": {
        yield* fs.remove(hunk.path)
        deleted.push(hunk.path)
        log.info(`Deleted file: ${hunk.path}`)
        break
      }

      case "update": {
        const originalText = yield* fs.readFileString(hunk.path)
        const fileUpdate = deriveNewContentsFromChunks(hunk.path, hunk.chunks, originalText)

        if (hunk.move_path) {
          yield* fs.writeWithDirs(hunk.move_path, Bom.join(fileUpdate.content, fileUpdate.bom))
          yield* fs.remove(hunk.path)
          modified.push(hunk.move_path)
          log.info(`Moved file: ${hunk.path} -> ${hunk.move_path}`)
        } else {
          yield* fs.writeWithDirs(hunk.path, Bom.join(fileUpdate.content, fileUpdate.bom))
          modified.push(hunk.path)
          log.info(`Updated file: ${hunk.path}`)
        }
        break
      }
    }
  }

  return { added, modified, deleted } satisfies AffectedPaths
})

// Main patch application function
export const applyPatch = Effect.fn("Patch.applyPatch")(function* (patchText: string) {
  const { hunks } = parsePatch(patchText)
  return yield* applyHunksToFiles(hunks)
})

type MaybeApplyPatchVerifiedResult =
  | { type: MaybeApplyPatchVerified.Body; action: ApplyPatchAction }
  | { type: MaybeApplyPatchVerified.CorrectnessError; error: Error }
  | { type: MaybeApplyPatchVerified.NotApplyPatch }

// Effectful verified-parse: needs AppFileSystem.Service to read existing files
export const maybeParseApplyPatchVerified = Effect.fn("Patch.maybeParseApplyPatchVerified")(function* (
  argv: string[],
  cwd: string,
) {
  // Detect implicit patch invocation (raw patch without apply_patch command)
  if (argv.length === 1) {
    try {
      parsePatch(argv[0])
      return {
        type: MaybeApplyPatchVerified.CorrectnessError,
        error: new Error(ApplyPatchError.ImplicitInvocation),
      } satisfies MaybeApplyPatchVerifiedResult
    } catch {
      // Not a patch, continue
    }
  }

  const result = maybeParseApplyPatch(argv)

  switch (result.type) {
    case MaybeApplyPatch.Body: {
      const fs = yield* AppFileSystem.Service
      const args = result.args
      const effectiveCwd = args.workdir ? path.resolve(cwd, args.workdir) : cwd
      const changes = new Map<string, ApplyPatchFileChange>()

      for (const hunk of args.hunks) {
        const resolvedPath = path.resolve(
          effectiveCwd,
          hunk.type === "update" && hunk.move_path ? hunk.move_path : hunk.path,
        )

        switch (hunk.type) {
          case "add":
            changes.set(resolvedPath, {
              type: "add",
              content: hunk.contents,
            })
            break

          case "delete": {
            const deletePath = path.resolve(effectiveCwd, hunk.path)
            const content = yield* fs.readFileString(deletePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (content === undefined) {
              return {
                type: MaybeApplyPatchVerified.CorrectnessError,
                error: new Error(`Failed to read file for deletion: ${deletePath}`),
              } satisfies MaybeApplyPatchVerifiedResult
            }
            changes.set(resolvedPath, {
              type: "delete",
              content,
            })
            break
          }

          case "update": {
            const updatePath = path.resolve(effectiveCwd, hunk.path)
            const originalText = yield* fs
              .readFileString(updatePath)
              .pipe(
                Effect.catch((cause) =>
                  Effect.succeed(new Error(`Failed to read file ${updatePath}: ${cause}`, { cause })),
                ),
              )
            if (originalText instanceof Error) {
              return {
                type: MaybeApplyPatchVerified.CorrectnessError,
                error: originalText,
              } satisfies MaybeApplyPatchVerifiedResult
            }
            try {
              const fileUpdate = deriveNewContentsFromChunks(updatePath, hunk.chunks, originalText)
              changes.set(resolvedPath, {
                type: "update",
                unified_diff: fileUpdate.unified_diff,
                move_path: hunk.move_path ? path.resolve(effectiveCwd, hunk.move_path) : undefined,
                new_content: fileUpdate.content,
              })
            } catch (error) {
              return {
                type: MaybeApplyPatchVerified.CorrectnessError,
                error: error as Error,
              } satisfies MaybeApplyPatchVerifiedResult
            }
            break
          }
        }
      }

      return {
        type: MaybeApplyPatchVerified.Body,
        action: {
          changes,
          patch: args.patch,
          cwd: effectiveCwd,
        },
      } satisfies MaybeApplyPatchVerifiedResult
    }

    case MaybeApplyPatch.PatchParseError:
      return {
        type: MaybeApplyPatchVerified.CorrectnessError,
        error: result.error,
      } satisfies MaybeApplyPatchVerifiedResult

    case MaybeApplyPatch.NotApplyPatch:
      return { type: MaybeApplyPatchVerified.NotApplyPatch } satisfies MaybeApplyPatchVerifiedResult
  }
})

export * as Patch from "."
