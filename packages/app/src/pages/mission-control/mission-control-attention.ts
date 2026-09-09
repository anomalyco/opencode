import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { batch } from "solid-js"
import { reconcile } from "solid-js/store"
import type { useGlobal } from "@/context/global"
import { normalizePermissionRequest } from "@/context/global-sync/utils"

type ServerCtx = ReturnType<ReturnType<typeof useGlobal>["ensureServerCtx"]>

// Pending approvals only reach the session store when their directory is bootstrapped, which
// happens on navigation. Mission control shows every project at once, so it lists the requests
// itself for each known worktree. Live events keep them current afterwards.
export async function sweepAttention(ctx: ServerCtx) {
  const directories = [
    ...new Set(ctx.projects.list().flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])])),
  ]
  if (directories.length === 0) return
  const v1 = (await ctx.sdk.protocol) === "v1"
  await Promise.all(directories.map((directory) => sweepDirectory(ctx, directory, v1)))
}

async function sweepDirectory(ctx: ServerCtx, directory: string, v1: boolean) {
  const [permissions, questions] = await Promise.all([
    listPermissions(ctx, directory, v1).catch(() => []),
    listQuestions(ctx, directory, v1).catch(() => []),
  ])
  if (permissions.length === 0 && questions.length === 0) return

  // Lineage resolution needs the raising session, which may be a subagent nobody has opened.
  await Promise.all(
    [...new Set([...permissions, ...questions].map((request) => request.sessionID))].map((sessionID) =>
      ctx.sync.session.resolve(sessionID).catch(() => undefined),
    ),
  )

  batch(() => {
    for (const [sessionID, items] of groupBySession(permissions)) {
      ctx.sync.session.set("permission", sessionID, reconcile(items, { key: "id" }))
    }
    for (const [sessionID, items] of groupBySession(questions)) {
      ctx.sync.session.set("question", sessionID, reconcile(items, { key: "id" }))
    }
  })
}

async function listPermissions(ctx: ServerCtx, directory: string, v1: boolean): Promise<PermissionRequest[]> {
  if (v1) return (await ctx.sdk.createClient({ directory }).permission.list()).data ?? []
  const result = await ctx.sdk.api.permission.request.list({ location: { directory } })
  return result.data.map(normalizePermissionRequest)
}

async function listQuestions(ctx: ServerCtx, directory: string, v1: boolean): Promise<QuestionRequest[]> {
  if (v1) return (await ctx.sdk.createClient({ directory }).question.list()).data ?? []
  const result = await ctx.sdk.api.question.request.list({ location: { directory } })
  return result.data
}

function groupBySession<T extends { id: string; sessionID: string }>(items: T[]) {
  return Map.groupBy(
    items.filter((item) => !!item?.id && !!item.sessionID),
    (item) => item.sessionID,
  )
}
