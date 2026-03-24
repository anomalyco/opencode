import { parse, type NapiConfig, type SgNode } from "@ast-grep/napi"
import { diffLines, createTwoFilesPatch } from "diff"
import path from "path"
import z from "zod"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { FileWatcher } from "../file/watcher"
import { LSP } from "../lsp"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { AstLang, buildMatcher, langInfo, resolveTarget, searchAst } from "./ast"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"

import DESCRIPTION from "./ast_edit.txt"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_DIAGNOSTICS_FILES = 5
const META = /\$\$\$[A-Z_][A-Z0-9_]*|\$[A-Z_][A-Z0-9_]*/g

type Filediff = ReturnType<typeof filediff>
type Diagnostics = Awaited<ReturnType<typeof LSP.diagnostics>>

function normalizeLineEndings(text: string) {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n") {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function rel(file: string) {
  const next = path.relative(Instance.worktree, file).replaceAll("\\", "/")
  return next || "."
}

function filediff(file: string, before: string, after: string) {
  const out = {
    file,
    before,
    after,
    additions: 0,
    deletions: 0,
  }
  for (const item of diffLines(before, after)) {
    if (item.added) out.additions += item.count || 0
    if (item.removed) out.deletions += item.count || 0
  }
  return out
}

function template(node: SgNode, input: string, src: string) {
  return input.replace(META, (token) => {
    if (token.startsWith("$$$")) {
      const list = node.getMultipleMatches(token.slice(3))
      if (list.length === 0) return token
      const first = list[0].range()
      const last = list[list.length - 1].range()
      return src.slice(first.start.index, last.end.index)
    }

    return node.getMatch(token.slice(1))?.text() ?? token
  })
}

function empty() {
  return {
    matches: 0,
    files: 0,
    diff: "",
    filediff: undefined as Filediff | undefined,
    filediffs: [] as Filediff[],
    diagnostics: {} as Diagnostics,
  }
}

async function rewrite(input: {
  file: string
  lang: AstLang
  matcher: NapiConfig
  rewrite: string
  abort: AbortSignal
}) {
  input.abort.throwIfAborted()
  const before = await Filesystem.readText(input.file)
  const next = convertToLineEnding(normalizeLineEndings(input.rewrite), detectLineEnding(before))

  try {
    const root = parse(langInfo(input.lang).lang, before)
    const nodes = root.root().findAll(input.matcher)
    if (nodes.length === 0) {
      return {
        before,
        after: before,
        matches: 0,
      }
    }
    const after = nodes[0].commitEdits(nodes.map((node) => node.replace(template(node, next, before))))
    return {
      before,
      after: before.endsWith("\r\n") && !after.endsWith("\r\n") ? after + "\r\n" : before.endsWith("\n") && !after.endsWith("\n") ? after + "\n" : after,
      matches: nodes.length,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to rewrite ${input.file}: ${msg}`)
  }
}

export const AstEditTool = Tool.define("ast_edit", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("AST pattern to rewrite"),
    rewrite: z.string().describe("Replacement template for the matched AST nodes"),
    lang: AstLang.describe("Language to parse: typescript, tsx, javascript, or jsx"),
    path: z.string().optional().describe("The file or directory to rewrite. Defaults to the current working directory."),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    const target = resolveTarget(params.path)
    const stat = Filesystem.stat(target)
    await assertExternalDirectory(ctx, target, { kind: stat?.isDirectory() ? "directory" : "file" })

    const matcher = buildMatcher(params.lang, params.pattern)
    const hits = await searchAst({
      path: target,
      lang: params.lang,
      matcher,
      abort: ctx.abort,
    })

    if (hits.length === 0) {
      return {
        title: rel(target),
        metadata: empty(),
        output: "No matches found",
      }
    }

    const files = [...new Set(hits.map((item) => item.path))]
    const plan: Array<{
      file: string
      relative: string
      diff: string
      filediff: ReturnType<typeof filediff>
      before: string
      after: string
      matches: number
    }> = []

    for (const file of files) {
      const item = await rewrite({
        file,
        lang: params.lang,
        matcher,
        rewrite: params.rewrite,
        abort: ctx.abort,
      })
      if (item.before === item.after) continue

      const diff = trimDiff(createTwoFilesPatch(file, file, normalizeLineEndings(item.before), normalizeLineEndings(item.after)))
      await FileTime.read(ctx.sessionID, file)
      plan.push({
        file,
        relative: rel(file),
        diff,
        filediff: filediff(file, item.before, item.after),
        before: item.before,
        after: item.after,
        matches: item.matches,
      })
    }

    if (plan.length === 0) {
      return {
        title: rel(target),
        metadata: empty(),
        output: "No changes applied",
      }
    }

    const diff = plan.map((item) => item.diff).join("\n")

    await ctx.ask({
      permission: "edit",
      patterns: plan.map((item) => item.relative),
      always: ["*"],
      metadata: {
        filepath: plan.map((item) => item.relative).join(", "),
        diff,
        files: plan.map((item) => ({
          filePath: item.file,
          relativePath: item.relative,
          diff: item.diff,
          before: item.before,
          after: item.after,
          additions: item.filediff.additions,
          deletions: item.filediff.deletions,
        })),
      },
    })

    const out: Array<{
      file: string
      relative: string
      diff: string
      filediff: ReturnType<typeof filediff>
      matches: number
    }> = []
    for (const item of plan) {
      await FileTime.withLock(item.file, async () => {
        await FileTime.assert(ctx.sessionID, item.file)
        const next = await rewrite({
          file: item.file,
          lang: params.lang,
          matcher,
          rewrite: params.rewrite,
          abort: ctx.abort,
        })
        if (next.before === next.after) return

        const diff = trimDiff(
          createTwoFilesPatch(item.file, item.file, normalizeLineEndings(next.before), normalizeLineEndings(next.after)),
        )
        const filediffs = filediff(item.file, next.before, next.after)

        await Filesystem.write(item.file, next.after)
        await Bus.publish(File.Event.Edited, {
          file: item.file,
        })
        await Bus.publish(FileWatcher.Event.Updated, {
          file: item.file,
          event: "change",
        })
        await FileTime.read(ctx.sessionID, item.file)

        out.push({
          file: item.file,
          relative: item.relative,
          diff,
          filediff: filediffs,
          matches: next.matches,
        })
      })
    }

    if (out.length === 0) {
      return {
        title: rel(target),
        metadata: empty(),
        output: "No changes applied",
      }
    }

    await Promise.all(out.map((item) => LSP.touchFile(item.file, true)))
    const diagnostics = await LSP.diagnostics()
    const finalDiff = out.map((item) => item.diff).join("\n")
    const filediffs = out.map((item) => item.filediff)
    const matches = out.reduce((sum, item) => sum + item.matches, 0)

    ctx.metadata({
      metadata: {
        matches,
        files: out.length,
        diff: finalDiff,
        filediff: filediffs[0],
        filediffs,
        diagnostics,
      },
    })

    const output = [`Applied AST rewrite to ${out.length} file${out.length === 1 ? "" : "s"} (${matches} matches).`, "", "Updated files:"]
    for (const item of out) {
      output.push(
        `- ${item.relative} (${item.matches} matches, +${item.filediff.additions}/-${item.filediff.deletions})`,
      )
    }

    let shown = 0
    for (const item of out) {
      if (shown >= MAX_DIAGNOSTICS_FILES) break
      const file = Filesystem.normalizePath(item.file)
      const errs = (diagnostics[file] ?? []).filter((entry) => entry.severity === 1)
      if (errs.length === 0) continue
      shown += 1
      const list = errs.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix = errs.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errs.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output.push("")
      output.push(`LSP errors detected in ${item.relative}, please fix:`)
      output.push(`<diagnostics file="${item.file}">`)
      output.push(list.map(LSP.Diagnostic.pretty).join("\n") + suffix)
      output.push(`</diagnostics>`)
    }

    return {
      title: out.length === 1 ? out[0].relative : rel(target),
      metadata: {
        matches,
        files: out.length,
        diff: finalDiff,
        filediff: filediffs[0],
        filediffs,
        diagnostics,
      },
      output: output.join("\n"),
    }
  },
})
