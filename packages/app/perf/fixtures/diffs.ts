import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { createPatch, createTwoFilesPatch, diffLines } from "diff"

/** `count` changed files of 300, 120 or 38 lines, three lines changed in each, with full-file hunks. */
export function reviewDiffs(count = 72) {
  return Array.from({ length: count }, (_, index) => {
    const lines = [300, 120, 38][index % 3]
    const file = `src/review/generated-${String(index).padStart(3, "0")}.ts`

    const before = Array.from(
      { length: lines },
      (_, line) => `export const value_${index}_${line} = "${words(index + line, line % 5 === 0 ? 180 : 42)}"`,
    ).join("\n")

    const middle = Math.max(8, Math.floor(lines / 2))

    const after = before
      .replace(`value_${index}_4`, `updated_${index}_4`)
      .replace(`value_${index}_${middle}`, `updated_${index}_${middle}`)
      .replace(`value_${index}_${lines - 4}`, `updated_${index}_${lines - 4}`)

    return { file, patch: fullPatch(file, before, after), additions: 3, deletions: 3, status: "modified" as const }
  })
}

/** `count` files of 50 removed and 50 added lines, 100 files to a folder: `src/review/d00000/file-00000.ts`. */
export function scalingDiffs(count: number) {
  const changes = Array.from({ length: 50 }, (_, index) => {
    const line = String(index).padStart(3, "0")

    return `-export const value_${line} = "before"\n+export const value_${line} = "after"`
  }).join("\n")

  return Array.from({ length: count }, (_, index) => {
    const file = scalingFile(index)

    return {
      file,
      patch: [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -1,50 +1,50 @@", changes].join(
        "\n",
      ),
      additions: 50,
      deletions: 50,
      status: "modified" as const,
    }
  })
}

export function scalingFile(index: number) {
  return `src/review/d${String(Math.floor(index / 100)).padStart(5, "0")}/file-${String(index).padStart(5, "0")}.ts`
}

/** The review tree's rows for `scalingDiffs(count)`: every file, `src`, `review`, and one folder per 100 files. */
export function scalingRows(count: number) {
  return count + 2 + Math.ceil(count / 100)
}

/**
 * `routes.ts` as `handlers` route handlers of 13 lines, with every tenth handler's status changed, as one
 * full-context patch: 120 handlers are 1,559 lines (60 KB); 1,200 are 15,599 lines (603 KB), past the size above which
 * the diff viewer stops highlighting and renders plain text.
 */
export function routesDiff(handlers: number) {
  const before = routes(handlers, 0)
  const after = routes(handlers, 1)
  const changed = Math.ceil(handlers / 10)

  return {
    file: "src/routes.ts",
    patch: createPatch("src/routes.ts", before, after, "", "", { context: Infinity }),
    additions: changed,
    deletions: changed,
    status: "modified" as const,
  }
}

/**
 * Four completed edit tools on Core's own tool sources (edit, patch, read and shell; about 60 KB), each renaming
 * `context` to `invocation`, with full-context patches: the timeline groups them into one file-change group.
 */
export async function editTools(): Promise<SessionMessageAssistantTool[]> {
  const names = ["edit", "patch", "read", "shell"]

  const sources = await Promise.all(
    names.map((name) =>
      Bun.file(new URL(`../../../core/src/tool/plugin/${name}.ts`, import.meta.url))
        .text()
        .then((text) => text.replaceAll("\r\n", "\n")),
    ),
  )

  return sources.map((before, index) => {
    const after = before.replaceAll(/\bcontext\b/g, "invocation")
    const file = `src/tool/plugin/${names[index]}.ts`

    const counts = diffLines(before, after).reduce(
      (sum, part) => ({
        additions: sum.additions + (part.added ? part.count : 0),
        deletions: sum.deletions + (part.removed ? part.count : 0),
      }),
      { additions: 0, deletions: 0 },
    )

    return {
      id: `prt_perf_edit_${index}`,
      type: "tool",
      name: "edit",
      state: {
        status: "completed",
        input: { path: file, oldString: "context", newString: "invocation", replaceAll: true },
        metadata: {
          files: [
            {
              file,
              patch: createTwoFilesPatch(file, file, before, after, "", "", { context: Infinity }),
              ...counts,
              status: "modified",
            },
          ],
        },
        content: [{ type: "text", text: `Edited ${file}` }],
      },
      time: { created: 1700000001100, ran: 1700000001100, completed: 1700000001200 },
    }
  })
}

function routes(count: number, revision: number) {
  return Array.from({ length: count }, (_, index) => {
    const status = index % 10 === 0 ? 200 + revision : 200

    return `export async function route${index}(request: Request, context: RouteContext) {
  const account = await context.accounts.find(request.headers.get("account-id"))
  if (!account) return new Response("Account not found", { status: 404 })
  const payload = await request.json()
  const record = await context.records.save({
    accountId: account.id,
    category: "route-${index}",
    title: payload.title.trim(),
    enabled: payload.enabled ?? true,
  })
  return Response.json({ id: record.id, status: ${status} })
}
`
  }).join("\n")
}

function fullPatch(file: string, before: string, after: string) {
  const a = before.split("\n")
  const b = after.split("\n")

  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.flatMap((line, index) => (line === b[index] ? [` ${line}`] : [`-${line}`, `+${b[index]}`])),
  ].join("\n")
}

function words(seed: number, length: number) {
  const list = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]

  return Array.from({ length: Math.ceil(length / 7) }, (_, index) => list[(seed + index * 3) % list.length]).join(" ")
}
